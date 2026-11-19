/**
 * Envelope for stored third-party secrets (sync tokens, SSO client secrets): AES-256-GCM with a key from
 * SECRET_ENCRYPTION_KEY (32 bytes, base64). Without the key, storing secrets is refused — never plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { invalid } from "./errors";

function key() {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw invalid("Secret storage isn't configured: set SECRET_ENCRYPTION_KEY (32 random bytes, base64) in the deployment environment.");
  return k;
}
export const secretsConfigured = () => { try { key(); return true; } catch { return false; } };
export function encryptSecret(plain: string) {
  const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}
export function decryptSecret(cipher: string) {
  const [v, iv, tag, body] = cipher.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64")); d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
