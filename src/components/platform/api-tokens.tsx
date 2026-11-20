"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { KeyRound, Trash2, Copy } from "lucide-react";
import { createPlatformTokenAction, revokePlatformTokenAction } from "@/app/platform-actions";
import { confirmDialog } from "@/components/ui/dialogs";

type Token = { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; mine: boolean };
const SCOPE_HELP: Record<string, string> = { "bases:read": "List bases", "schema:read": "Read tables, fields and views", "records:read": "Read records", "records:write": "Create, update and delete records" };
const inp: React.CSSProperties = { height: 34, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "var(--color-text-primary)", font: "inherit", padding: "0 8px" };

export function ApiTokensView({ tokens, scopes }: { tokens: Token[]; scopes: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<string[]>(["bases:read", "schema:read", "records:read"]);
  const [created, setCreated] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  return (
    <div style={{ padding: "28px 32px", maxWidth: 960 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>API &amp; tokens</h1>
      <p style={{ color: "var(--color-text-secondary)", margin: "4px 0 16px" }}>
        Personal access tokens for the REST API (<a href="/api/v2/openapi.json" target="_blank" rel="noreferrer">OpenAPI spec</a>). A token acts as you — it can only reach bases, tables and fields you can, and stops working if your access is removed. Scopes narrow it further.
      </p>
      <section className="p-basecard" style={{ display: "block", marginBottom: 16 }}>
        <strong>Create a token</strong>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <input aria-label="Token name" placeholder="e.g. Reporting sync" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, flex: "1 1 220px" }} />
          {scopes.map((s) => (
            <label key={s} className={`chip ${sel.includes(s) ? "blue" : ""}`} style={{ cursor: "pointer" }} title={SCOPE_HELP[s]}>
              <input type="checkbox" checked={sel.includes(s)} onChange={() => setSel((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))} /> {s}
            </label>
          ))}
          <Button label="Create token" variant="primary" icon={<KeyRound size={14} />} clickAction={async () => {
            setErr(""); setCreated(null);
            const r = await createPlatformTokenAction(name, sel);
            if (!r.ok) { setErr(r.error); return; }
            setCreated(r.data.token); setName(""); router.refresh();
          }} />
        </div>
        {err && <p role="alert" style={{ color: "var(--color-text-error)", marginTop: 8 }}>{err}</p>}
        {created && (
          <div role="status" style={{ marginTop: 12, padding: 10, borderRadius: 6, background: "var(--color-background-yellow)" }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}><strong>Copy this token now</strong> — it won&apos;t be shown again.</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <code style={{ overflowWrap: "anywhere", flex: 1 }}>{created}</code>
              <button type="button" className="p-tbtn" onClick={() => navigator.clipboard?.writeText(created).catch(() => {})}><Copy size={14} />Copy</button>
            </div>
            <pre style={{ fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>curl -H &quot;Authorization: Bearer {created.slice(0, 10)}…&quot; {origin}/api/v2/bases</pre>
          </div>
        )}
      </section>
      <div className="p-basecard" style={{ display: "block", padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ textAlign: "left", fontSize: 12, color: "var(--color-text-secondary)" }}><th style={{ padding: "10px 14px" }}>Name</th><th>Scopes</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>{tokens.map((t) => (
            <tr key={t.id} style={{ borderTop: "1px solid var(--color-border)" }}>
              <td style={{ padding: "10px 14px" }}>{t.name}{!t.mine && <span className="chip" style={{ marginLeft: 6 }}>other member</span>}</td>
              <td><span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{t.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</span></td>
              <td style={{ fontSize: 13 }}>{new Date(t.createdAt).toLocaleDateString("en-GB")}</td>
              <td style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("en-GB") : "Never"}</td>
              <td style={{ paddingRight: 14 }}><button type="button" className="p-tbtn" style={{ color: "var(--color-text-red)" }} onClick={async () => { if (!(await confirmDialog(`Revoke “${t.name}”? Apps using it stop working immediately.`, { danger: true, confirmLabel: "Revoke" }))) return; const r = await revokePlatformTokenAction(t.id); if (!r.ok) setErr(r.error); router.refresh(); }}><Trash2 size={14} />Revoke</button></td>
            </tr>
          ))}</tbody>
        </table>
        {!tokens.length && <p style={{ padding: 14, color: "var(--color-text-secondary)" }}>No tokens yet.</p>}
      </div>
    </div>
  );
}
