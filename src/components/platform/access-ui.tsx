"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Users } from "lucide-react";
import { setBaseMemberAction, updateBaseAction } from "@/app/platform-actions";
import type { BaseMeta } from "@/app/(base)/base/[baseId]/load";
import { BaseHeader } from "./base-header";

const ROLES = ["owner", "creator", "editor", "commenter", "reader"];
const RANK: Record<string, number> = { owner: 5, creator: 4, editor: 3, commenter: 2, reader: 1, none: 0 };

/** Mirrors server effectiveRole(): explicit membership wins; private bases admit only owners otherwise. */
function effective(visibility: string, workspaceRole: string, override: string | null) {
  if (override === "none") return workspaceRole === "owner" ? "owner" : null;
  if (override) return override;
  if (visibility === "private") return workspaceRole === "owner" ? "owner" : null;
  return workspaceRole;
}

export function AccessApp({ meta, visibility, isOwner, people }: { meta: BaseMeta; visibility: string; isOwner: boolean; people: { id: string; name: string; role: string; override: string | null }[] }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const isPrivate = visibility === "private";
  return (
    <div className="p-base">
      <BaseHeader base={meta.base} role={meta.role} active="access" />
      <main style={{ flex: 1, overflow: "auto", background: "var(--color-background-muted)", padding: 24 }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Who can access “{meta.base.name}”</h1>
          <div role="radiogroup" aria-label="Base visibility" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" }}>
            {([["workspace", Users, "Workspace", "Everyone in the workspace gets their workspace role here, unless you set a base role or deny them."], ["private", Lock, "Private", "Only workspace owners and the people you add below. Everyone else can't see that this base exists."]] as const).map(([v, Icon, title, desc]) => (
              <button key={v} type="button" role="radio" aria-checked={visibility === v} disabled={!isOwner}
                className="p-basecard" style={{ textAlign: "left", alignItems: "flex-start", cursor: isOwner ? "pointer" : "default", borderColor: visibility === v ? "var(--color-accent)" : undefined, boxShadow: visibility === v ? "0 0 0 1px var(--color-accent)" : undefined }}
                onClick={async () => { if (visibility === v) return; setErr(""); const r = await updateBaseAction(meta.base.id, { visibility: v }); if (!r.ok) setErr(r.error); router.refresh(); }}>
                <Icon size={18} aria-hidden />
                <span><span className="t" style={{ display: "block" }}>{title}</span><span className="s">{desc}</span></span>
              </button>
            ))}
          </div>
          {!isOwner && <p style={{ color: "var(--color-text-secondary)", fontSize: 12, marginBottom: 12 }}>Only base owners can change visibility.</p>}
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "4px 0 16px" }}>Commenters and readers are free seats: they can view (and commenters can comment) but never edit. Table, field and view permissions apply on top. Workspace owners always keep access.</p>
          {err && <p role="alert" style={{ color: "var(--color-text-error)" }}>{err}</p>}
          <div className="p-basecard" style={{ display: "block", padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--color-text-secondary)", fontSize: 12 }}><th style={{ padding: "10px 14px" }}>Person</th><th>Workspace role</th><th>Access to this base</th><th style={{ paddingRight: 14 }}>Result</th></tr></thead>
              <tbody>{people.map((p) => { const eff = effective(visibility, p.role, p.override); return (
                <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "10px 14px" }}>{p.name}</td>
                  <td><span className="chip">{p.role}</span></td>
                  <td>
                    <select aria-label={`Access for ${p.name}`} disabled={!meta.canEdit} value={p.override ?? ""} onChange={async (e) => { setErr(""); const r = await setBaseMemberAction(meta.base.id, p.id, e.target.value || null); if (!r.ok) setErr(r.error); router.refresh(); }}
                      style={{ height: 32, borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", color: "inherit", font: "inherit" }}>
                      <option value="">{isPrivate ? "Not added" : `Same as workspace (${p.role})`}</option>
                      {ROLES.filter((r) => RANK[r] <= RANK[meta.role]).map((r) => <option key={r} value={r}>{r}{r === "commenter" || r === "reader" ? " (free)" : ""}</option>)}
                      {!isPrivate && p.role !== "owner" && <option value="none">No access (deny)</option>}
                    </select>
                  </td>
                  <td style={{ paddingRight: 14 }}>{eff ? <span className={`chip ${RANK[eff] >= 3 ? "blue" : "green"}`}>{eff}</span> : <span className="chip red">no access</span>}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
