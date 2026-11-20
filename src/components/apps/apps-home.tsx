"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@/components/ui/modal";
import { LayoutDashboard, PencilRuler, Globe } from "lucide-react";
import { createAppAction, createAppFromTemplateAction } from "@/app/apps-actions";
import { BaseIcon } from "@/components/platform/icons";

export type AppCard = { id: string; name: string; slug: string; description: string | null; audience: string; published: boolean; canBuild: boolean; color: string; icon: string };
export type AppTpl = { key: string; name: string; description: string; icon: string; color: string };

export function AppsSection({ apps, templates, canCreate, bases }: { apps: AppCard[]; templates: AppTpl[]; canCreate: boolean; bases: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginBottom: 36 }} aria-label="Apps">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>Apps</h2>
        {canCreate && <Button label="New app" icon={<PencilRuler size={15} />} onClick={() => setOpen(true)} />}
      </div>
      {apps.length ? (
        <div className="p-bases">
          {apps.map((a) => (
            <div key={a.id} className="p-basecard" style={{ alignItems: "flex-start" }}>
              <span className={`p-tile p-c-${a.color}`}>{a.audience === "portal" ? <Globe size={22} /> : <BaseIcon name={a.icon} />}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="t" style={{ display: "block" }}>{a.name}</span>
                <span className="s" style={{ display: "block" }}>{a.audience === "portal" ? "Client portal" : "App"} · {a.published ? "Published" : "Draft"}</span>
                <span style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 13 }}>
                  {a.published && <Link href={`/a/${a.slug}`}>Open</Link>}
                  {a.canBuild && <Link href={`/builder/${a.id}`}>Edit in builder</Link>}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : <p className="ap-muted" style={{ fontSize: 14 }}>Apps turn your data into navigable pages, dashboards, forms and client portals — built visually and published to your team.</p>}
      {canCreate && <>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: "18px 0 10px", color: "var(--color-text-secondary)" }}>Start from an app template</h3>
        <AppTemplateGrid templates={templates} />
      </>}
      <NewAppDialog isOpen={open} onClose={() => setOpen(false)} bases={bases} />
    </section>
  );
}

export function AppTemplateGrid({ templates }: { templates: AppTpl[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState("");
  return (
    <>
      <div className="p-bases">
        {templates.map((t) => (
          <button key={t.key} type="button" className="p-basecard" style={{ textAlign: "left", cursor: "pointer", alignItems: "flex-start" }} disabled={!!busy} aria-label={`Use app template ${t.name}`}
            onClick={async () => { setBusy(t.key); setErr(""); const r = await createAppFromTemplateAction(t.key); if (r.ok) router.push(`/a/${r.data.slug}`); else { setErr(r.error); setBusy(null); } }}>
            <span className={`p-tile p-c-${t.color}`}><LayoutDashboard size={22} /></span>
            <span><span className="t" style={{ display: "block" }}>{busy === t.key ? "Creating…" : t.name}</span><span className="s">{t.description}</span></span>
          </button>
        ))}
      </div>
      {err && <p role="alert" style={{ color: "var(--color-text-error)", marginTop: 8 }}>{err}</p>}
    </>
  );
}

function NewAppDialog({ isOpen, onClose, bases }: { isOpen: boolean; onClose: () => void; bases: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [baseId, setBaseId] = useState(bases[0]?.id ?? ""); const [err, setErr] = useState("");
  const inp: React.CSSProperties = { width: "100%", height: 36, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-background-surface)", color: "inherit", font: "inherit", padding: "0 10px" };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && onClose()} width={480} padding={6} purpose="form">
      <div style={{ display: "block", flex: "none" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>New app</h2>
        <p className="ap-muted" style={{ margin: "6px 0 12px", fontSize: 14 }}>An app is a set of pages over one base. You design it in the builder, then publish it for your team.</p>
        <label style={{ display: "grid", gap: 4, marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 600 }}>App name</span><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operations hub" /></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, fontWeight: 600 }}>Data from base</span><select style={inp} value={baseId} onChange={(e) => setBaseId(e.target.value)}>{bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {!bases.length && <p className="ap-muted" style={{ fontSize: 13 }}>Create a base first (or use an app template).</p>}
        {err && <p role="alert" style={{ color: "var(--color-text-error)" }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button label="Cancel" onClick={onClose} />
          <Button label="Create and open builder" variant="primary" isDisabled={!name.trim() || !baseId} clickAction={async () => { const r = await createAppAction({ baseId, name }); if (!r.ok) setErr(r.error); else router.push(`/builder/${r.data.id}`); }} />
        </div>
      </div>
    </Dialog>
  );
}
