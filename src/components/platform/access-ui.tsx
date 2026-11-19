"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setBaseMemberAction } from "@/app/platform-actions";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";

const ROLES = ["owner", "creator", "editor", "commenter", "reader"];
const RANK: Record<string, number> = { owner: 5, creator: 4, editor: 3, commenter: 2, reader: 1 };

export function AccessApp({ meta, people }: { meta: BaseMeta; people: { id: string; name: string; role: string; override: string | null }[] }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="access" />
      <main style={{ flex: 1, overflow: "auto", background: "var(--color-background-muted)", padding: 24 }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Who can access “{meta.base.name}”</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "4px 0 16px" }}>Everyone gets their workspace role here unless you set a base-specific role. Commenters and readers are free seats: they can view (and commenters can comment) but never edit. Table, field and view permissions apply on top.</p>
          {err && <p style={{ color: "var(--color-text-error)" }}>{err}</p>}
          <div className="p-basecard" style={{ display: "block", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--color-text-secondary)", fontSize: 12 }}><th style={{ padding: "10px 14px" }}>Person</th><th>Workspace role</th><th>Access to this base</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "10px 14px" }}>{p.name}</td>
                  <td><span className="chip">{p.role}</span></td>
                  <td style={{ paddingRight: 14 }}>
                    <select aria-label={`Access for ${p.name}`} disabled={!meta.canEdit} value={p.override ?? ""} onChange={async (e) => { setErr(""); const r = await setBaseMemberAction(meta.base.id, p.id, e.target.value || null); if (!r.ok) setErr(r.error); router.refresh(); }}
                      style={{ height: 32, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", color: "inherit", font: "inherit" }}>
                      <option value="">Same as workspace ({p.role})</option>
                      {ROLES.filter((r) => RANK[r] <= RANK[meta.role]).map((r) => <option key={r} value={r}>{r}{r === "commenter" || r === "reader" ? " (free)" : ""}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
