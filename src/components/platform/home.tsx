"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Badge } from "@astryxdesign/core/Badge";
import { Plus, Sparkles, Upload, LayoutTemplate, FilePlus2 } from "lucide-react";
import { COLORS } from "@/lib/platform/fields";
import { createBaseAction, createBaseFromTemplateAction } from "@/app/platform-actions";
import { DemoLoader } from "@/components/demo-loader";
import { BASE_ICONS, BaseIcon } from "./icons";
import { ImportDialog } from "./import-dialog";
import { AiBuilderDialog } from "./ai-builder";

type BaseCard = { id: string; name: string; icon: string; color: string; role: string; updatedAt: string };
type Tpl = { key: string; name: string; description: string; category: string; icon: string; color: string };

export function HomeView({ bases, templates, canCreate, loadDemo }: { bases: BaseCard[]; templates: Tpl[]; canCreate: boolean; loadDemo: boolean }) {
  const [dialog, setDialog] = useState<null | "blank" | "templates" | "import" | "ai">(null);
  return (
    <div style={{ padding: "28px 32px", maxWidth: 1280 }}>
      {loadDemo && <DemoLoader auto />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, flex: 1 }}>Home</h1>
        {canCreate && <DropdownMenu button={{ label: "Create", variant: "primary", icon: <Plus size={16} /> }} alignment="end" items={[
          { label: "Start from scratch", icon: <FilePlus2 size={16} />, description: "A blank base with one table", onClick: () => setDialog("blank") },
          { label: "Build with AI", icon: <Sparkles size={16} />, description: "Describe what you need; get tables, fields and views", onClick: () => setDialog("ai") },
          { label: "Use a template", icon: <LayoutTemplate size={16} />, description: "Production, CRM, projects, content and more", onClick: () => setDialog("templates") },
          { label: "Import a spreadsheet", icon: <Upload size={16} />, description: "CSV or Excel → a new base", onClick: () => setDialog("import") },
        ]} />}
      </div>
      {bases.length === 0 ? (
        <EmptyState title="No bases yet" description="A base is a database for one system — a production, a CRM, a content calendar. Start from scratch, a template, a spreadsheet, or describe it to AI."
          actions={canCreate ? <><Button label="Use a template" variant="primary" onClick={() => setDialog("templates")} /><Button label="Build with AI" onClick={() => setDialog("ai")} /></> : undefined} />
      ) : (
        <div className="p-bases">
          {bases.map((b) => (
            <Link key={b.id} href={`/base/${b.id}`} className="p-basecard">
              <span className={`p-tile p-c-${b.color}`}><BaseIcon name={b.icon} /></span>
              <span style={{ minWidth: 0 }}><span className="t" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span><span className="s">Edited {new Date(b.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {b.role}</span></span>
            </Link>
          ))}
        </div>
      )}
      {canCreate && <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Start with a template</h2>
        <TemplateGrid templates={templates.slice(0, 4)} />
      </section>}
      <NewBaseDialog isOpen={dialog === "blank"} onClose={() => setDialog(null)} />
      <Dialog isOpen={dialog === "templates"} onOpenChange={(o) => !o && setDialog(null)} width={920} padding={6}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Templates</h2>
        <TemplateGrid templates={templates} />
      </Dialog>
      <ImportDialog isOpen={dialog === "import"} onClose={() => setDialog(null)} />
      <AiBuilderDialog isOpen={dialog === "ai"} onClose={() => setDialog(null)} />
    </div>
  );
}

export function TemplateGrid({ templates }: { templates: Tpl[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  return (
    <>
      {err && <p style={{ color: "var(--color-text-error)", marginBottom: 8 }}>{err}</p>}
      <div className="p-bases" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {templates.map((t) => (
          <button key={t.key} className="p-basecard" style={{ textAlign: "left", cursor: "pointer", alignItems: "flex-start" }} disabled={!!busy} aria-label={`Use template ${t.name}`}
            onClick={async () => { setBusy(t.key); setErr(""); const r = await createBaseFromTemplateAction(t.key); if (r.ok) router.push(`/base/${r.data.id}`); else { setErr(r.error); setBusy(null); } }}>
            <span className={`p-tile p-c-${t.color}`} style={{ width: 44, height: 44 }}><BaseIcon name={t.icon} size={20} /></span>
            <span style={{ minWidth: 0 }}>
              <span className="t" style={{ display: "flex", gap: 6, alignItems: "center" }}>{t.name} {busy === t.key && <Badge label="Creating…" variant="info" />}</span>
              <span className="s" style={{ display: "block", marginTop: 2 }}>{t.description}</span>
              <span className="s" style={{ display: "block", marginTop: 6 }}>{t.category}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function NewBaseDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("Untitled base");
  const [color, setColor] = useState<string>("blue");
  const [icon, setIcon] = useState("grid");
  const [err, setErr] = useState("");
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && onClose()} width={480} padding={6} purpose="form">
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New base</h2>
      <div style={{ display: "grid", gap: 16 }}>
        <TextInput label="Name" value={name} onChange={setName} />
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Colour</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{COLORS.map((c) => <button key={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className={`p-c-${c}`} style={{ width: 28, height: 28, borderRadius: 8, border: color === c ? "3px solid var(--color-text-primary)" : "0", cursor: "pointer" }} />)}</div></div>
        <div><div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Icon</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{Object.keys(BASE_ICONS).map((k) => <button key={k} aria-label={k} aria-pressed={icon === k} onClick={() => setIcon(k)} className={icon === k ? `p-tile p-c-${color}` : "p-tile"} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--color-border)", cursor: "pointer", color: icon === k ? "#fff" : "var(--color-text-primary)", background: icon === k ? undefined : "var(--color-background-muted)" }}><BaseIcon name={k} size={16} /></button>)}</div></div>
        {err && <p style={{ color: "var(--color-text-error)" }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Cancel" onClick={onClose} />
          <Button label="Create base" variant="primary" clickAction={async () => { const r = await createBaseAction({ name, color, icon }); if (r.ok) router.push(`/base/${r.data.id}`); else setErr(r.error); }} />
        </div>
      </div>
    </Dialog>
  );
}
