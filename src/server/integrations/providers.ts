/**
 * External provider adapters. Every adapter is DISABLED unless the provider is configured AND the
 * explicit enable flag is set. The legacy S'appening contract automation embedded a bearer token —
 * it is intentionally not present anywhere in this codebase; replacements come only from managed
 * environment secrets.
 *
 * A `test-sink` provider exists solely for automated tests (NODE_ENV=test). It never leaves the
 * process and is labelled as such in every record it produces.
 */
export type ProviderStatus = { enabled: boolean; provider: string | null; reason?: string };

export function mailStatus(): ProviderStatus {
  const provider = process.env.MAIL_PROVIDER || null;
  if (provider === "test-sink") return process.env.NODE_ENV === "test" ? { enabled: true, provider } : { enabled: false, provider, reason: "test-sink provider is only available in automated tests" };
  if (!provider || !process.env.MAIL_API_KEY) return { enabled: false, provider, reason: "No mail provider is configured" };
  if (process.env.ENABLE_REAL_EMAIL !== "true") return { enabled: false, provider, reason: "Real email is disabled (ENABLE_REAL_EMAIL is not true)" };
  return { enabled: true, provider };
}

export function signingStatus(): ProviderStatus {
  const provider = process.env.SIGNING_PROVIDER || null;
  if (provider === "test-sink") return process.env.NODE_ENV === "test" ? { enabled: true, provider } : { enabled: false, provider, reason: "test-sink provider is only available in automated tests" };
  if (!provider || !process.env.SIGNING_API_KEY) return { enabled: false, provider, reason: "No e-signature provider is configured" };
  if (process.env.ENABLE_REAL_SIGNATURE_REQUESTS !== "true") return { enabled: false, provider, reason: "Live signature requests are disabled (ENABLE_REAL_SIGNATURE_REQUESTS is not true)" };
  return { enabled: true, provider };
}

export class ProviderError extends Error { constructor(m: string, public retryable: boolean) { super(m); } }

/** Test-only failure injection, so retry / dead-letter paths can be verified. */
export const testSink = { sent: [] as { to: string; subject: string; idempotencyKey: string }[], failNext: 0 };

export async function sendMail(msg: { to: string; subject: string; body: string; idempotencyKey: string }): Promise<{ providerMessageId: string }> {
  const s = mailStatus();
  if (!s.enabled) throw new ProviderError(s.reason ?? "Mail disabled", false);
  if (s.provider === "test-sink") {
    if (testSink.failNext > 0) { testSink.failNext--; throw new ProviderError("test-sink: simulated network failure", true); }
    if (!testSink.sent.some((m) => m.idempotencyKey === msg.idempotencyKey)) testSink.sent.push({ to: msg.to, subject: msg.subject, idempotencyKey: msg.idempotencyKey });
    return { providerMessageId: `test-sink:${msg.idempotencyKey}` };
  }
  if (s.provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": msg.idempotencyKey },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.body }),
    });
    if (!res.ok) throw new ProviderError(`Mail provider HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const j = (await res.json()) as { id: string };
    return { providerMessageId: j.id };
  }
  throw new ProviderError(`Unsupported mail provider "${s.provider}"`, false);
}

export async function requestSignature(doc: { contractId: string; title: string; signerEmail: string; idempotencyKey: string }): Promise<{ providerRef: string }> {
  const s = signingStatus();
  if (!s.enabled) throw new ProviderError(s.reason ?? "Signing disabled", false);
  if (s.provider === "test-sink") return { providerRef: `test-sink:${doc.idempotencyKey}` };
  // A real provider (e.g. DocuSign, Dropbox Sign) must be integrated and contract-tested before enabling.
  throw new ProviderError(`Signing provider "${s.provider}" has no verified adapter yet`, false);
}
