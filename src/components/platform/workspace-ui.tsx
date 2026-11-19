"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { inviteMemberAction, saveSsoAction, setPlatformRoleAction } from "@/app/platform-actions";

const ROLES = [["owner", "Owner", "Everything, including billing, security and roles"], ["creator", "Creator", "Build bases, tables, fields, views and automations"], ["editor", "Editor", "Add and edit records"], ["commenter", "Commenter (free)", "View and comment"], ["reader", "Reader (free)", "View only"]] as const;
const inp: React.CSSProperties = { width: "100%", height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "12px 0 4px" };
const page: React.CSSProperties = { padding: "28px 32px", maxWidth: 1040 };

type Member = { userId: string; name: string; email: string; platformRole: string; seat: string; disabledAt: string | null; lastLoginAt: string | null };
export function MembersView({ me, isOwner, members }: { me: string; isOwner: boolean; members: Member[] }) {
  const router = useRouter();
  const [err, setErr] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState("editor"); const [link, setLink] = useState("");
  const paid = members.filter((m) => m.seat === "paid" && !m.disabledAt).length;
  return (
    <div style={page}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Members &amp; roles</h1>
      <p style={{ color: "var(--color-text-secondary)", margin: "4px 0 16px" }}>{paid} paid seat{paid === 1 ? "" : "s"} · {members.length - paid} free (commenter/reader). Per-base access is set from each base&apos;s Access tab; table, field and view permissions apply on top.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 20 }}>
        {ROLES.map(([k, l, d]) => <div key={k} className="p-basecard" style={{ display: "block", padding: 12 }}><div className="t">{l}</div><div className="s">{d}</div></div>)}
      </div>
      {isOwner && (
        <form className="p-basecard" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }} onSubmit={async (e) => { e.preventDefault(); setErr(""); setLink(""); const r = await inviteMemberAction(email, role); if (!r.ok) setErr(r.error); else { setLink(`${location.origin}${r.data.link}`); setEmail(""); } }}>
          <strong style={{ width: "100%" }}>Invite someone</strong>
          <input aria-label="Email" type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inp, flex: 2, minWidth: 200 }} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inp, flex: 1, minWidth: 140 }}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button type="submit" className="p-tbtn on-blue">Create invite link</button>
          {link && <p style={{ width: "100%", fontSize: 13 }}>Share this one-time link (expires in 7 days; no email is sent): <code style={{ overflowWrap: "anywhere" }}>{link}</code></p>}
        </form>
      )}
      {err && <p style={{ color: "var(--color-text-error)", marginBottom: 8 }}>{err}</p>}
      <div className="p-basecard" style={{ display: "block", padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ textAlign: "left", fontSize: 12, color: "var(--color-text-secondary)" }}><th style={{ padding: "10px 14px" }}>Name</th><th>Email</th><th>Role</th><th>Seat</th><th style={{ paddingRight: 14 }}>Last sign-in</th></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.userId} style={{ borderTop: "1px solid var(--color-border)", opacity: m.disabledAt ? 0.5 : 1 }}>
              <td style={{ padding: "10px 14px" }}>{m.name}{m.userId === me ? " (you)" : ""}</td>
              <td style={{ color: "var(--color-text-secondary)" }}>{m.email}</td>
              <td>{isOwner ? <select aria-label={`Role for ${m.name}`} value={m.platformRole} onChange={async (e) => { setErr(""); const r = await setPlatformRoleAction(m.userId, e.target.value); if (!r.ok) setErr(r.error); router.refresh(); }} style={{ height: 30, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", color: "inherit", font: "inherit" }}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : m.platformRole}</td>
              <td><span className={`chip ${m.seat === "free" ? "green" : "blue"}`}>{m.seat}</span></td>
              <td style={{ paddingRight: 14, color: "var(--color-text-secondary)", fontSize: 13 }}>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Never"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

type Sso = { issuer: string; clientId: string; hasSecret: boolean; allowedDomains: string[]; defaultRole: string; isEnabled: boolean; enforce: boolean; updatedAt: string } | null;
export function SecurityView({ sso, orgSlug, secrets }: { sso: Sso; orgSlug: string; secrets: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ issuer: sso?.issuer ?? "", clientId: sso?.clientId ?? "", clientSecret: "", domains: sso?.allowedDomains.join(", ") ?? "", defaultRole: sso?.defaultRole ?? "reader", isEnabled: sso?.isEnabled ?? false, enforce: sso?.enforce ?? false });
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  return (
    <div style={{ ...page, maxWidth: 760 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Security &amp; single sign-on</h1>
      <p style={{ color: "var(--color-text-secondary)", margin: "4px 0 16px" }}>OpenID Connect SSO with any standards-compliant identity provider (Okta, Microsoft Entra ID, Google Workspace, Auth0, JumpCloud…).</p>
      {!secrets && <p className="p-basecard" style={{ color: "var(--color-text-orange)", marginBottom: 12 }}>SECRET_ENCRYPTION_KEY isn&apos;t set on this deployment, so the client secret can&apos;t be stored yet. Add a 32-byte base64 key to the environment, then return here.</p>}
      <div className="p-basecard" style={{ display: "block" }}>
        <p style={{ fontSize: 13 }}>In your identity provider, create an OIDC web application with redirect URI <code>{origin}/api/auth/sso/callback</code> and scopes <code>openid email profile</code>. People sign in from the login page with workspace ID <code>{orgSlug}</code>.</p>
        <label style={lbl} htmlFor="sso-iss">Issuer URL</label><input id="sso-iss" style={inp} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} placeholder="https://your-tenant.okta.com" />
        <label style={lbl} htmlFor="sso-cid">Client ID</label><input id="sso-cid" style={inp} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />
        <label style={lbl} htmlFor="sso-sec">Client secret {sso?.hasSecret && "(stored — leave blank to keep)"}</label><input id="sso-sec" type="password" autoComplete="off" style={inp} value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} />
        <label style={lbl} htmlFor="sso-dom">Allowed email domains (comma-separated)</label><input id="sso-dom" style={inp} value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} placeholder="company.com" />
        <label style={lbl} htmlFor="sso-role">Role for people who sign in for the first time</label>
        <select id="sso-role" style={inp} value={f.defaultRole} onChange={(e) => setF({ ...f, defaultRole: e.target.value })}><option value="reader">Reader (free)</option><option value="commenter">Commenter (free)</option><option value="editor">Editor</option></select>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}><input type="checkbox" checked={f.isEnabled} onChange={(e) => setF({ ...f, isEnabled: e.target.checked })} />Enable SSO</label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={f.enforce} disabled={!f.isEnabled} onChange={(e) => setF({ ...f, enforce: e.target.checked })} />Require SSO for these domains (owners keep password sign-in as a break-glass)</label>
        {err && <p style={{ color: "var(--color-text-error)", marginTop: 10 }}>{err}</p>}
        {msg && <p role="status" style={{ marginTop: 10 }}>{msg}</p>}
        <div style={{ marginTop: 16 }}><Button label="Save" variant="primary" clickAction={async () => {
          setErr(""); setMsg("");
          const r = await saveSsoAction({ issuer: f.issuer, clientId: f.clientId, clientSecret: f.clientSecret, allowedDomains: f.domains.split(","), defaultRole: f.defaultRole, isEnabled: f.isEnabled, enforce: f.enforce });
          if (!r.ok) setErr(r.error); else { setMsg(f.isEnabled ? "Saved. The issuer configuration was verified." : "Saved (SSO is off)."); setF({ ...f, clientSecret: "" }); router.refresh(); }
        }} /></div>
      </div>
    </div>
  );
}

export function AuditView({ rows, total, q }: { rows: { id: string; at: string; actor: string; action: string; entity: string; entityId: string | null; detail: string }[]; total: number; q: string }) {
  return (
    <div style={page}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Audit log</h1>
      <p style={{ color: "var(--color-text-secondary)", margin: "4px 0 16px" }}>Append-only record of {total.toLocaleString("en-GB")} actions in this workspace — schema changes, permissions, exports, imports, syncs, automations, sign-ins and more.</p>
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input name="q" defaultValue={q} aria-label="Filter audit log" placeholder="Filter by action, person or entity" style={{ ...inp, maxWidth: 360 }} />
        <button className="p-tbtn on-blue" type="submit">Filter</button>
      </form>
      <div className="p-basecard" style={{ display: "block", padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ textAlign: "left", fontSize: 12, color: "var(--color-text-secondary)" }}><th style={{ padding: "10px 14px" }}>When</th><th>Who</th><th>Action</th><th>Entity</th><th style={{ paddingRight: 14 }}>Detail</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)", verticalAlign: "top" }}>
              <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</td>
              <td>{r.actor}</td><td><span className="chip">{r.action}</span></td><td>{r.entity}</td>
              <td className="mono" style={{ paddingRight: 14, maxWidth: 380, overflowWrap: "anywhere", color: "var(--color-text-secondary)" }}>{r.detail}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <p style={{ padding: 14, color: "var(--color-text-secondary)" }}>Nothing matches.</p>}
      </div>
      {rows.length === 100 && <p style={{ marginTop: 10 }}><a href={`?${new URLSearchParams({ ...(q ? { q } : {}), before: rows[rows.length - 1].at })}`}>Older entries →</a></p>}
    </div>
  );
}
