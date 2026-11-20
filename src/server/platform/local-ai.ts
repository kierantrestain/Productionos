/**
 * Private AI: run every AI feature on a model you host (Ollama, vLLM, LM Studio, LocalAI… — anything
 * that speaks the OpenAI-compatible /v1/chat/completions API), so no data leaves your network.
 *
 *   AI_PROVIDER=local
 *   LOCAL_AI_BASE_URL=http://ollama:11434/v1     # your model server
 *   LOCAL_AI_MODEL=qwen2.5:14b                   # a model with tool calling (agents) and JSON output
 *   LOCAL_AI_API_KEY=…                           # only if your server requires one
 *
 * This adapter mimics the small part of the Anthropic client the app uses (messages.create / .parse and
 * beta.messages.create), so every feature — AI fields, planner, assistant, agents, automations — works
 * unchanged. Features that need a public service (web research) are refused, never silently sent out.
 */
import { invalid } from "../errors";

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; source?: { type: string; media_type?: string; data?: string } };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Req = { max_tokens?: number; system?: string; messages: Msg[]; tools?: { name: string; description?: string; input_schema?: unknown; type?: string }[]; output_config?: { format?: { schema?: unknown; parse?: (s: string) => unknown } } };

export type AiProvider = "anthropic" | "local" | "off";
export function aiProvider(): AiProvider {
  const p = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (p === "off") return "off";
  if (p === "local") return process.env.LOCAL_AI_BASE_URL ? "local" : "off";
  if (p === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : "off";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.LOCAL_AI_BASE_URL ? "local" : "off";
}
export const aiIsPrivate = () => aiProvider() === "local";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Test seam (MOCK-ONLY tests). */
export function __setLocalAiFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }

function toOpenAi(req: Req) {
  const out: Record<string, unknown>[] = [];
  if (req.system) out.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      const calls = m.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
      else if (b.type === "text") parts.push({ type: "text", text: b.text ?? "" });
      else if (b.type === "image" && b.source?.type === "base64") parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
      else if (b.type === "document") throw invalid("Reading PDFs isn't available with the private AI model. Use images, or switch AI provider.");
    }
    if (parts.length) out.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
  }
  return out;
}

async function complete(req: Req, json?: { schema?: unknown }) {
  const base = (process.env.LOCAL_AI_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) throw invalid("Private AI isn't configured: set LOCAL_AI_BASE_URL and LOCAL_AI_MODEL.");
  const tools = (req.tools ?? []).map((t) => {
    if (t.type && t.type !== "custom" && !t.input_schema) throw invalid("Web research isn't available with the private AI model (it would send your question to a public service).");
    return { type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object", properties: {} } } };
  });
  const body = {
    model: process.env.LOCAL_AI_MODEL || "qwen2.5:14b", max_tokens: Math.min(req.max_tokens ?? 4000, 16000), messages: toOpenAi(req), stream: false,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    ...(json ? { response_format: { type: "json_schema", json_schema: { name: "output", schema: json.schema, strict: true } } } : {}),
  };
  const r = await fetcher(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.LOCAL_AI_API_KEY ? { Authorization: `Bearer ${process.env.LOCAL_AI_API_KEY}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) })
    .catch((e) => { throw invalid(`Couldn't reach the private AI model at ${base}: ${(e as Error).message}`); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw invalid(`The private AI model returned ${r.status}${j?.error?.message ? `: ${j.error.message}` : ""}.`);
  const choice = j.choices?.[0] ?? {}; const msg = choice.message ?? {};
  const content: Block[] = [];
  if (msg.content) content.push({ type: "text", text: String(msg.content) });
  for (const c of msg.tool_calls ?? []) { let input: unknown = {}; try { input = JSON.parse(c.function?.arguments || "{}"); } catch { /* keep empty */ } content.push({ type: "tool_use", id: c.id || `call_${Math.random().toString(36).slice(2)}`, name: c.function?.name, input }); }
  const stop_reason = content.some((b) => b.type === "tool_use") ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn";
  return { id: j.id ?? "local", type: "message", role: "assistant", model: body.model, content, stop_reason, usage: j.usage ?? {} };
}

/** Anthropic-client–shaped facade over the local model. */
export function localAiClient() {
  const create = (req: Req) => complete(req);
  return {
    messages: {
      create,
      parse: async (req: Req) => {
        const fmt = req.output_config?.format;
        const res = await complete(req, { schema: fmt?.schema });
        const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").replace(/^```(json)?\s*|\s*```$/g, "");
        let parsed: unknown = null;
        try { parsed = fmt?.parse ? fmt.parse(text) : JSON.parse(text); } catch { throw invalid("The private AI model didn't return valid structured output. Try again, or use a larger model."); }
        return { ...res, parsed_output: parsed };
      },
    },
    beta: { messages: { create } },
  };
}
