/**
 * OpenID Connect single sign-on per organisation (Okta, Entra ID, Google Workspace, Auth0, …).
 * Authorization-code flow with PKCE, state and nonce; ID tokens are verified against the issuer's JWKS
 * (signature, issuer, audience, expiry, nonce). Users from allowed email domains are provisioned just in
 * time with the configured least-privilege platform role. Owners can always use password sign-in
 * (break-glass) even when SSO is enforced.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@/db";
import { memberships, organisations, ssoConfigs, users } from "@/db/schema";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { forbidden, invalid, notFound } from "../errors";
import type { Ctx } from "./context";

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Test seam (mock-only integration tests). */
export function __setSsoFetcher(f: Fetcher | null) { fetcher = f ?? ((u, i) => fetch(u, i)); }
let jwksFactory = (uri: string) => createRemoteJWKSet(new URL(uri));
export function __setJwks(f: ((uri: string) => ReturnType<typeof createRemoteJWKSet>) | null) { jwksFactory = f ?? ((uri) => createRemoteJWKSet(new URL(uri))); }

const SSO_ROLES = ["reader", "commenter", "editor"] as const;
const b64url = (b: Buffer) => b.toString("base64url");

async function discover(issuer: string): Promise<Discovery> {
  const iss = issuer.replace(/\/+$/, "");
  if (!/^https:\/\//.test(iss)) throw invalid("The issuer must be an https:// URL.");
  const r = await fetcher(`${iss}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw invalid(`Couldn't load the issuer's OpenID configuration (HTTP ${r.status}).`);
  const d = await r.json() as Discovery;
  if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw invalid("The issuer's OpenID configuration is incomplete.");
  if (d.issuer.replace(/\/+$/, "") !== iss) throw invalid("The issuer in the OpenID configuration doesn't match.");
  return d;
}

export async function getSso(ctx: Ctx) {
  const [c] = await db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, ctx.orgId)).limit(1);
  return c ? { issuer: c.issuer, clientId: c.clientId, hasSecret: !!c.clientSecretCipher, allowedDomains: c.allowedDomains, defaultRole: c.defaultRole, isEnabled: c.isEnabled, enforce: c.enforce, updatedAt: c.updatedAt.toISOString() } : null;
}

export async function saveSso(ctx: Ctx, input: { issuer: string; clientId: string; clientSecret?: string; allowedDomains: string[]; defaultRole: string; isEnabled: boolean; enforce: boolean }) {
  if (ctx.platformRole !== "owner") throw forbidden("Only workspace owners can configure single sign-on.");
  const issuer = input.issuer.trim().replace(/\/+$/, "");
  if (input.isEnabled) await discover(issuer);
  if (!input.clientId.trim()) throw invalid("Enter the client ID.");
  const domains = [...new Set(input.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  if (input.isEnabled && !domains.length) throw invalid("Add at least one allowed email domain.");
  if (domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) throw invalid("Domains look like example.com.");
  if (!SSO_ROLES.includes(input.defaultRole as never)) throw invalid("New SSO users can be readers, commenters or editors.");
  const [cur] = await db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, ctx.orgId)).limit(1);
  const secretCipher = input.clientSecret?.trim() ? encryptSecret(input.clientSecret.trim()) : cur?.clientSecretCipher ?? null;
  if (input.isEnabled && !secretCipher) throw invalid("Enter the client secret.");
  const values = { issuer, clientId: input.clientId.trim(), clientSecretCipher: secretCipher, allowedDomains: domains, defaultRole: input.defaultRole, isEnabled: input.isEnabled, enforce: input.isEnabled && input.enforce, updatedAt: new Date(), updatedBy: ctx.userId };
  await db.insert(ssoConfigs).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: ssoConfigs.orgId, set: values });
  await audit(db, ctx, "update_sso", "organisations", ctx.orgId, { meta: { issuer, domains, enabled: values.isEnabled, enforce: values.enforce, secretChanged: !!input.clientSecret?.trim() } });
}

/** Begin sign-in: returns the IdP URL and an encrypted state cookie value. */
export async function startSso(orgSlug: string, redirectUri: string) {
  const [org] = await db.select().from(organisations).where(eq(organisations.slug, orgSlug.trim().toLowerCase())).limit(1);
  const [c] = org ? await db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, org.id)).limit(1) : [];
  if (!org || !c?.isEnabled) throw notFound("Single sign-on isn't set up for that workspace.");
  const d = await discover(c.issuer);
  const state = b64url(randomBytes(24)), nonce = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: c.clientId, redirect_uri: redirectUri, scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(k, v);
  const cookie = encryptSecret(JSON.stringify({ orgId: org.id, state, nonce, verifier, redirectUri, exp: Date.now() + 10 * 60_000 }));
  return { url: url.toString(), cookie };
}

/** Finish sign-in: verifies everything and returns the user + org to create a session for. */
export async function finishSso(params: { code?: string | null; state?: string | null; error?: string | null }, cookie: string | undefined) {
  if (params.error) throw invalid(`Your identity provider returned an error: ${params.error}`);
  if (!cookie) throw invalid("Your sign-in session expired. Please start again.");
  const s = JSON.parse(decryptSecret(cookie)) as { orgId: string; state: string; nonce: string; verifier: string; redirectUri: string; exp: number };
  if (Date.now() > s.exp || !params.state || params.state !== s.state || !params.code) throw invalid("Sign-in state didn't match. Please start again.");
  const [c] = await db.select().from(ssoConfigs).where(eq(ssoConfigs.orgId, s.orgId)).limit(1);
  if (!c?.isEnabled || !c.clientSecretCipher) throw notFound("Single sign-on is no longer enabled.");
  const d = await discover(c.issuer);
  const body = new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: s.redirectUri, client_id: c.clientId, client_secret: decryptSecret(c.clientSecretCipher), code_verifier: s.verifier });
  const tr = await fetcher(d.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(10_000) });
  if (!tr.ok) throw invalid(`The identity provider refused the sign-in (HTTP ${tr.status}).`);
  const { id_token } = await tr.json() as { id_token?: string };
  if (!id_token) throw invalid("The identity provider didn't return an ID token.");
  const { payload } = await jwtVerify(id_token, jwksFactory(d.jwks_uri), { issuer: d.issuer, audience: c.clientId });
  if (payload.nonce !== s.nonce) throw invalid("Sign-in nonce didn't match.");
  const email = String(payload.email ?? "").toLowerCase();
  if (!email || payload.email_verified === false) throw forbidden("Your identity provider didn't supply a verified email address.");
  if (!c.allowedDomains.includes(email.split("@")[1] ?? "")) throw forbidden("Your email domain isn't allowed to sign in to this workspace.");
  const name = String(payload.name ?? payload.given_name ?? email.split("@")[0]).slice(0, 120);
  let [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (u?.disabledAt) throw forbidden("Your account has been disabled.");
  if (!u) [u] = await db.insert(users).values({ email, name, passwordHash: null }).returning();
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, s.orgId), eq(memberships.userId, u.id))).limit(1);
  if (!m) await db.insert(memberships).values({ orgId: s.orgId, userId: u.id, role: "external_reviewer", platformRole: c.defaultRole });
  await audit(db, { orgId: s.orgId, userId: u.id, name }, m ? "sso_login" : "sso_provision", "users", u.id, { meta: { issuer: c.issuer, sub: payload.sub } });
  return { userId: u.id, orgId: s.orgId };
}

/** Password sign-in is blocked for non-owners whose org enforces SSO for their email domain. */
export async function passwordBlockedBySso(userId: string, email: string) {
  const rows = await db.select({ role: memberships.platformRole, c: ssoConfigs }).from(memberships).innerJoin(ssoConfigs, eq(ssoConfigs.orgId, memberships.orgId)).where(eq(memberships.userId, userId));
  const domain = email.toLowerCase().split("@")[1];
  return rows.some((r) => r.c.isEnabled && r.c.enforce && r.c.allowedDomains.includes(domain) && r.role !== "owner");
}
