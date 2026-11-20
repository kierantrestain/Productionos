"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Blueprint } from "@/lib/templates";
import { humanize } from "@/lib/format";
import { archiveTemplateAction, createFromTemplateAction } from "@/app/actions";
import { useRun } from "./client";
import { Icon } from "./icons";
import { confirmDialog } from "@/components/ui/dialogs";

type T = { id: string; source: "built-in" | "organisation"; blueprint: Blueprint };

export function TemplateWizard({ templates, canManage }: { templates: T[]; canManage: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [sel, setSel] = useState<T | null>(null);
  const [f, setF] = useState({ title: "", code: "", startDate: "", endDate: "", units: 0, season: "", usesEpisodes: true, terms: { unit: "", units: "", item: "", items: "" } });
  const [inc, setInc] = useState({ runningOrder: true, budget: true, deliverables: true, post: true, tasks: true });
  const pick = (t: T) => { setSel(t); setF({ ...f, units: t.blueprint.defaults.units, usesEpisodes: t.blueprint.usesEpisodes, terms: { ...t.blueprint.terms } }); };
  const bp = sel?.blueprint;
  const preview = useMemo(() => {
    if (!bp) return null;
    const units = f.usesEpisodes ? f.units : 0;
    const containers = f.usesEpisodes ? units : 1;
    const per = (perUnit: boolean) => (perUnit && f.usesEpisodes ? units : 1);
    return {
      units, items: inc.runningOrder ? bp.runningOrder.length * containers : 0, budget: inc.budget ? bp.budget.length : 0,
      deliverables: inc.deliverables ? bp.deliverables.reduce((a, d) => a + per(d.perUnit), 0) : 0,
      post: inc.post ? bp.post.reduce((a, d) => a + per(d.perUnit), 0) : 0, tasks: inc.tasks ? bp.tasks.length : 0,
      runtime: bp.runningOrder.reduce((a, r) => a + r.mins, 0),
    };
  }, [bp, f, inc]);

  if (!sel || !bp || !preview) {
    const groups = [["built-in", "Production types"], ["organisation", "Your organisation’s templates"]] as const;
    return (
      <div className="stack">
        {groups.map(([src, label]) => {
          const list = templates.filter((t) => t.source === src);
          if (!list.length) return null;
          return (
            <section key={src} aria-label={label}>
              <h2 style={{ marginBottom: 10 }}>{label}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {list.map((t) => (
                  <div key={t.id} className="panel" style={{ display: "flex", flexDirection: "column" }}>
                    <button className="panel-body" onClick={() => pick(t)} style={{ all: "unset", cursor: "pointer", padding: 16, flex: 1 }} aria-label={`Use template ${t.blueprint.name}`}>
                      <div style={{ fontWeight: 650, marginBottom: 4 }}>{t.blueprint.name}</div>
                      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t.blueprint.description}</div>
                      <div className="row" style={{ gap: 4 }}>
                        <span className="badge plain">{humanize(t.blueprint.kind)}</span>
                        <span className="badge plain">{t.blueprint.usesEpisodes ? `${t.blueprint.defaults.units} ${t.blueprint.terms.units.toLowerCase()}` : "Standalone"}</span>
                        {t.blueprint.runningOrder.length > 0 && <span className="badge plain">{t.blueprint.runningOrder.length} {t.blueprint.terms.items.toLowerCase()}</span>}
                      </div>
                    </button>
                    {src === "organisation" && canManage && <div style={{ padding: "0 16px 12px" }}><button className="btn btn-quiet btn-sm btn-danger" onClick={async () => (await confirmDialog(`Remove template “${t.blueprint.name}”?`, { danger: true, confirmLabel: "Remove" })) && run(archiveTemplateAction(t.id.slice(4)), "Template removed").then((r) => r !== undefined && router.refresh())}>Remove</button></div>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(createFromTemplateAction({
      template: sel.id, title: f.title, code: f.code || null, startDate: f.startDate || null, endDate: f.endDate || null,
      units: f.usesEpisodes ? Number(f.units) : 0, seasonNumber: f.season ? Number(f.season) : null, usesEpisodes: f.usesEpisodes, include: inc, terms: f.terms,
    }), "Production created");
    if (r) router.push(`/productions/${r.productionId}`);
  };
  return (
    <form onSubmit={submit} className="grid-2">
      <section className="panel" aria-label="Production details">
        <div className="panel-head"><h2>{bp.name}</h2><button type="button" className="btn btn-quiet btn-sm" onClick={() => setSel(null)}>← Change template</button></div>
        <div className="panel-body form-grid">
          <div className="field wide"><label htmlFor="w-title">Title *</label><input id="w-title" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="w-code">Code</label><input id="w-code" className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label htmlFor="w-start">Start</label><input id="w-start" className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /><span className="help">Kickoff task due dates are calculated from this</span></div>
          <div className="field"><label htmlFor="w-end">End / delivery</label><input id="w-end" className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
          <label className="check wide"><input type="checkbox" checked={f.usesEpisodes} onChange={(e) => setF({ ...f, usesEpisodes: e.target.checked })} /> Has {f.terms.units.toLowerCase() || "episodes"} (turn off for a standalone film, ad or one-off)</label>
          {f.usesEpisodes && <>
            <div className="field"><label htmlFor="w-units">Number of {f.terms.units.toLowerCase()}</label><input id="w-units" className="input" type="number" min={0} max={200} value={f.units} onChange={(e) => setF({ ...f, units: Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor="w-season">Series / season number</label><input id="w-season" className="input" type="number" min={1} value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} placeholder="optional" /></div>
          </>}
          <fieldset className="wide" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <legend className="label">Terminology for this production</legend>
            <div className="form-grid">
              {(["unit", "units", "item", "items"] as const).map((k) => (
                <div key={k} className="field"><label htmlFor={`w-t-${k}`}>{{ unit: "Unit (singular)", units: "Units (plural)", item: "Item (singular)", items: "Items (plural)" }[k]}</label>
                  <input id={`w-t-${k}`} className="input" value={f.terms[k]} onChange={(e) => setF({ ...f, terms: { ...f.terms, [k]: e.target.value } })} /></div>
              ))}
            </div>
          </fieldset>
          <fieldset className="wide" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <legend className="label">Include</legend>
            <div className="row">
              {(Object.keys(inc) as (keyof typeof inc)[]).map((k) => <label key={k} className="check"><input type="checkbox" checked={inc[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} /> {{ runningOrder: bp.terms.items, budget: "Budget top sheet", deliverables: "Deliverables", post: "Post pipeline", tasks: "Kickoff tasks" }[k]}</label>)}
            </div>
          </fieldset>
          <div className="wide"><button className="btn btn-primary btn-lg" disabled={pending || !f.title.trim()}>{pending ? "Creating…" : "Create production"}</button></div>
        </div>
      </section>
      <aside className="panel" aria-label="What will be created">
        <div className="panel-head"><h2>What will be created</h2></div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          <dl className="kv">
            {f.usesEpisodes && <><dt>{f.terms.units || "Episodes"}</dt><dd>{preview.units}</dd></>}
            <dt>{f.terms.items || "Items"}</dt><dd>{preview.items}{bp.runningOrder.length > 0 && <span className="subtle"> · ~{preview.runtime} min each {f.terms.unit.toLowerCase()}</span>}</dd>
            <dt>Budget lines</dt><dd>{preview.budget} <span className="subtle">(categories only, £0 — you add figures)</span></dd>
            <dt>Deliverables</dt><dd>{preview.deliverables}</dd>
            <dt>Post tasks</dt><dd>{preview.post}</dd>
            <dt>Kickoff tasks</dt><dd>{preview.tasks}</dd>
          </dl>
          {inc.runningOrder && bp.runningOrder.length > 0 && <div><div className="label" style={{ marginBottom: 4 }}>{f.terms.items}</div><ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{bp.runningOrder.map((r, i) => <li key={i}>{r.title} <span className="subtle">· {humanize(r.kind)} · {r.mins}m</span></li>)}</ol></div>}
          <p className="subtle" style={{ fontSize: 12 }}><Icon name="shield" size={12} /> No people, figures or creative content are invented — only structure.</p>
        </div>
      </aside>
    </form>
  );
}
