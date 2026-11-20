"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { createTokenAction, inviteAction, revokeTokenAction, setDisabledAction, setProductionsAction, setRoleAction } from "@/app/actions";
import { Drawer, useRun } from "./client";
import { confirmDialog } from "@/components/ui/dialogs";

type Member = { userId: string; name: string; email: string; role: string; disabledAt: string | null; lastLoginAt: string | null; productionIds: string[] };

export function AdminMembers({ me, members, invites, productions }: { me: string; members: Member[]; invites: { id: string; email: string; role: string; acceptedAt: string | null; expiresAt: string }[]; productions: { id: string; title: string }[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<Member | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [inv, setInv] = useState({ email: "", role: "crew" as Role, prods: [] as string[] });
  const [link, setLink] = useState<string | null>(null);
  const ok = (r: unknown) => { if (r !== undefined) router.refresh(); };
  return (
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2>Members</h2><span className="subtle">{members.length}</span></div>
        <div className="table-wrap" style={{ border: 0 }}><table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Productions</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.userId}>
              <td style={{ fontWeight: 560 }}>{m.name}</td><td>{m.email}</td>
              <td><select className="select cell-edit" aria-label={`Role for ${m.name}`} value={m.role} disabled={m.userId === me || pending} onChange={async (e) => (await confirmDialog(`Change ${m.name}'s role? Their sessions will be signed out.`)) && run(setRoleAction(m.userId, e.target.value as Role), "Role updated").then(ok)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></td>
              <td>{["org_admin", "executive", "finance_legal", "commercial"].includes(m.role) ? <span className="subtle">All</span> : <button className="btn btn-sm" onClick={() => { setEditing(m); setSel(m.productionIds); }}>{m.productionIds.length} assigned</button>}</td>
              <td>{dateTime(m.lastLoginAt)}</td>
              <td>{m.disabledAt ? <span className="badge tone-bad">Disabled</span> : <span className="badge tone-ok">Active</span>}</td>
              <td>{m.userId !== me && <button className="btn btn-quiet btn-sm" onClick={async () => (await confirmDialog(`${m.disabledAt ? "Re-enable" : "Disable"} ${m.name}?`)) && run(setDisabledAction(m.userId, !m.disabledAt), "Updated").then(ok)}>{m.disabledAt ? "Enable" : "Disable"}</button>}</td>
            </tr>))}</tbody></table></div>
      </section>
      <section className="panel"><div className="panel-head"><h2>Invite someone</h2></div>
        <form className="panel-body form-grid" onSubmit={async (e) => { e.preventDefault(); const r = await run(inviteAction(inv.email, inv.role, inv.prods)); if (r) { setLink(`${location.origin}/invite/${r.token}`); setInv({ email: "", role: "crew", prods: [] }); router.refresh(); } }}>
          <div className="field"><label htmlFor="inv-email">Email</label><input id="inv-email" className="input" type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="inv-role">Role</label><select id="inv-role" className="select" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
          <div className="field wide"><span className="label">Productions</span><div className="row">{productions.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={inv.prods.includes(p.id)} onChange={(e) => setInv({ ...inv, prods: e.target.checked ? [...inv.prods, p.id] : inv.prods.filter((x) => x !== p.id) })} />{p.title}</label>)}</div></div>
          <div className="wide"><button className="btn btn-primary" disabled={pending}>Create invitation</button></div>
        </form>
        {link && <div className="notice info" style={{ margin: "0 16px 16px" }}><div>One-time invitation link (shown once — share it securely): <code className="mono" style={{ wordBreak: "break-all" }}>{link}</code></div></div>}
        {invites.length > 0 && <ul className="list">{invites.map((i) => <li key={i.id}><span style={{ flex: 1 }}>{i.email}</span><span className="badge plain">{ROLE_LABELS[i.role as Role] ?? i.role}</span><span className={`badge ${i.acceptedAt ? "tone-ok" : "tone-warn"}`}>{i.acceptedAt ? "Accepted" : `Expires ${dateTime(i.expiresAt)}`}</span></li>)}</ul>}
      </section>
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={`Production access — ${editing?.name ?? ""}`}
        footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={() => run(setProductionsAction(editing!.userId, sel), "Access updated").then((r) => { setEditing(null); ok(r); })}>Save</button></>}>
        <div className="stack" style={{ gap: 8 }}>{productions.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />{p.title}</label>)}</div>
      </Drawer>
    </div>
  );
}

const SCOPES = ["productions:read", "schedule:read", "status:read", "scripts:write"];
export function AdminTokens({ tokens }: { tokens: { id: string; name: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }[] }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["status:read"]);
  const [shown, setShown] = useState<string | null>(null);
  return (
    <section className="panel"><div className="panel-head"><h2>Integration tokens</h2><span className="subtle" style={{ fontSize: 12 }}>For SWDR / Mimic OS via /api/v1 — never shares the database</span></div>
      <form className="panel-body row" onSubmit={async (e) => { e.preventDefault(); const r = await run(createTokenAction(name, scopes)); if (r) { setShown(r.token); setName(""); router.refresh(); } }}>
        <input className="input" style={{ width: 220 }} required placeholder="Token name (e.g. SWDR staging)" aria-label="Token name" value={name} onChange={(e) => setName(e.target.value)} />
        {SCOPES.map((s) => <label key={s} className="check mono" style={{ fontSize: 12 }}><input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />{s}</label>)}
        <button className="btn btn-primary" disabled={pending || !scopes.length}>Create token</button>
      </form>
      {shown && <div className="notice warn" style={{ margin: "0 16px 16px" }}><div>Copy this token now — it will not be shown again: <code className="mono" style={{ wordBreak: "break-all" }}>{shown}</code></div></div>}
      <ul className="list">{tokens.map((t) => <li key={t.id}><strong style={{ flex: 1 }}>{t.name}</strong><span className="mono subtle" style={{ fontSize: 12 }}>{t.scopes.join(", ")}</span><span className="subtle">{t.lastUsedAt ? `used ${dateTime(t.lastUsedAt)}` : "never used"}</span>{t.revokedAt ? <span className="badge tone-bad">Revoked</span> : <button className="btn btn-sm btn-danger" onClick={async () => (await confirmDialog(`Revoke ${t.name}?`, { danger: true, confirmLabel: "Revoke" })) && run(revokeTokenAction(t.id), "Revoked").then((r) => r !== undefined && router.refresh())}>Revoke</button>}</li>)}
        {!tokens.length && <li className="subtle">No tokens.</li>}</ul>
    </section>
  );
}
