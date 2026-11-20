/**
 * "Connect your ChatGPT plan" — Sign in with ChatGPT (OAuth 2.0 authorization code + PKCE S256 + OIDC
 * against auth.openai.com). Agents set to "ChatGPT plan" then run on the chatting person's own plan,
 * within the per-app limit they set in ChatGPT (Settings → Usage → App limits).
 *
 * OpenAI currently offers this to selected partners: it needs an OpenAI-issued client ID
 * (OPENAI_SIWC_CLIENT_ID) and a registered callback URL. Without them the feature reports
 * "not configured". Tokens are encrypted at rest (SECRET_ENCRYPTION_KEY) and never sent to the browser.
 * Scopes, resource, API base and model are configurable because OpenAI's partner docs define them.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userConnections } from "@/db/schema";
import type { Ctx } from "../auth/context";
import { audit } from "../audit";
import { decryptSecret, encryptSecret, secretsConfigured } from "../crypto";
import { invalid } from "../errors";

const ISSUER = "https://auth.openai.com";
const FALLBACK = { authorization_endpoint: `${ISSUER}/api/accounts/authorize`, token_endpoint: `${ISSUER}/api/accounts/oauth/token` };
export const chatgptConfigured = () => Boolean(process.env.OPENAI_SIWC_CLIENT_ID) && secretsConfigured();
export const chatgptStatusReason = () => !process.env.OPENAI_SIWC_CLIENT_ID ? "Sign in with ChatGPT needs an OpenAI-issued client ID (OPENAI_SIWC_CLIENT_ID). OpenAI currently offers it to selected partners." : !secretsConfigured() ? "Set SECRET_ENCRYPTION_KEY so ChatGPT tokens can be stored encrypted." : null;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
export function __setChatgptFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }

let discovery: { authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string } | null = null;
async function endpoints() {
  if (discovery) return discovery;
  try { const r = await fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) }); if (r.ok) { const j = await r.json(); if (j.authorization_endpoint && j.token_endpoint) return (discovery = j); } } catch { /* fall back to documented endpoints */ }
  return FALLBACK;
}
const b64url = (b: Buffer) => b.toString("base64url");

/** Build the authorize URL. The caller stores {state, verifier} in an httpOnly cookie. */
export async function startChatgptConnect(redirectUri: string) {
  const why = chatgptStatusReason(); if (why) throw invalid(why);
  const state = b64url(randomBytes(24)); const verifier = b64url(randomBytes(48)); const nonce = b64url(randomBytes(16));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const e = await endpoints();
  const q = new URLSearchParams({ response_type: "code", client_id: process.env.OPENAI_SIWC_CLIENT_ID!, redirect_uri: redirectUri, scope: process.env.OPENAI_SIWC_SCOPES || "openid email profile offline_access", state, nonce, code_challenge: challenge, code_challenge_method: "S256", ...(process.env.OPENAI_SIWC_RESOURCE ? { resource: process.env.OPENAI_SIWC_RESOURCE } : {}) });
  return { url: `${e.authorization_endpoint}?${q}`, state, verifier };
}

async function tokenRequest(params: Record<string, string>) {
  const e = await endpoints();
  const body = new URLSearchParams({ client_id: process.env.OPENAI_SIWC_CLIENT_ID!, ...params, ...(process.env.OPENAI_SIWC_CLIENT_SECRET ? { client_secret: process.env.OPENAI_SIWC_CLIENT_SECRET } : {}) });
  const r = await fetcher(e.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw invalid(`ChatGPT sign-in failed${j.error_description || j.error ? `: ${j.error_description ?? j.error}` : ""}.`);
  return j as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string };
}

function emailFromIdToken(idt?: string) {
  // Display label only — never used for authentication.
  try { const p = JSON.parse(Buffer.from(String(idt).split(".")[1], "base64url").toString()); return typeof p.email === "string" ? p.email.slice(0, 200) : null; } catch { return null; }
}

export async function finishChatgptConnect(ctx: Ctx, input: { code: string; state: string; expectedState: string; verifier: string; redirectUri: string }) {
  if (!input.state || input.state !== input.expectedState) throw invalid("This sign-in link expired or was tampered with. Please try again.");
  const t = await tokenRequest({ grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier });
  const row = { orgId: ctx.orgId, userId: ctx.userId, provider: "chatgpt", accountLabel: emailFromIdToken(t.id_token), accessTokenEnc: encryptSecret(t.access_token), refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : null, expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, scopes: t.scope ?? null, updatedAt: new Date() };
  await db.insert(userConnections).values(row).onConflictDoUpdate({ target: [userConnections.orgId, userConnections.userId, userConnections.provider], set: row });
  await audit(db, ctx, "connect_chatgpt", "user_connections", ctx.userId, { meta: { account: row.accountLabel } });
  return { account: row.accountLabel };
}

export async function chatgptConnection(ctx: Pick<Ctx, "orgId" | "userId">) {
  const [c] = await db.select().from(userConnections).where(and(eq(userConnections.orgId, ctx.orgId), eq(userConnections.userId, ctx.userId), eq(userConnections.provider, "chatgpt"))).limit(1);
  return c ?? null;
}

/** A valid access token for the person, refreshing it when close to expiry. */
async function accessToken(ctx: Pick<Ctx, "orgId" | "userId">) {
  const c = await chatgptConnection(ctx);
  if (!c) throw invalid("Connect your ChatGPT plan first (Settings → Connected apps).");
  if (!c.expiresAt || c.expiresAt.getTime() > Date.now() + 60_000) return decryptSecret(c.accessTokenEnc);
  if (!c.refreshTokenEnc) throw invalid("Your ChatGPT connection expired. Reconnect it in Settings → Connected apps.");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(c.refreshTokenEnc) });
  await db.update(userConnections).set({ accessTokenEnc: encryptSecret(t.access_token), ...(t.refresh_token ? { refreshTokenEnc: encryptSecret(t.refresh_token) } : {}), expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, updatedAt: new Date() }).where(eq(userConnections.id, c.id));
  return t.access_token;
}

export async function disconnectChatgpt(ctx: Ctx) {
  const c = await chatgptConnection(ctx); if (!c) return;
  const e = await endpoints();
  if (e.revocation_endpoint) { try { await fetcher(e.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.OPENAI_SIWC_CLIENT_ID ?? "", token: decryptSecret(c.refreshTokenEnc ?? c.accessTokenEnc) }), signal: AbortSignal.timeout(8000) }); } catch { /* best effort; the local copy is deleted regardless */ } }
  await db.delete(userConnections).where(eq(userConnections.id, c.id));
  await audit(db, ctx, "disconnect_chatgpt", "user_connections", ctx.userId, {});
}

/** One Responses API call on the person's ChatGPT plan. Limits and errors come back from OpenAI unchanged. */
export async function chatgptResponses(ctx: Pick<Ctx, "orgId" | "userId">, body: Record<string, unknown>) {
  const token = await accessToken(ctx);
  const base = (process.env.OPENAI_SIWC_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
  const r = await fetcher(`${base}/responses`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_SIWC_MODEL || "gpt-5", ...body }), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) throw invalid("Your ChatGPT plan's limit for this app has been reached. Raise it in ChatGPT (Settings → Usage → App limits) or try later.");
  if (r.status === 401) throw invalid("Your ChatGPT connection is no longer valid. Reconnect it in Settings → Connected apps.");
  if (!r.ok) throw invalid(`ChatGPT returned ${r.status}${j?.error?.message ? `: ${j.error.message}` : ""}.`);
  return j as { output?: ({ type: "message"; content?: { type: string; text?: string }[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: string })[]; status?: string };
}
