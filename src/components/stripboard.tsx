"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { date, time } from "@/lib/format";
import { addSceneToDayAction, createRecord, moveBlockAction, removeBlockAction } from "@/app/actions";
import { useRun } from "./client";

type Scene = { id: string; number: string; title: string; estDurationMins: number | null; episode: string | null };
type Day = { id: string; date: string; dayNumber: number | null; unit: string; status: string; errors: number; eighths: number; mins: number; blocks: { id: string; sceneId: string | null; number: string | null; title: string; start: string | null }[] };

/** Stripboard: drag unscheduled scenes onto days, drag strips between days. Keyboard: “Add to day” selects. */
export function Stripboard({ productionId, unscheduled, days, canWrite }: { productionId: string; unscheduled: Scene[]; days: Day[]; canWrite: boolean }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [drag, setDrag] = useState<{ type: "scene" | "block"; id: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const done = (r: unknown) => { if (r !== undefined) router.refresh(); };
  const drop = (dayId: string) => {
    if (!drag) return;
    if (drag.type === "scene") run(addSceneToDayAction(dayId, drag.id), "Scheduled").then(done);
    else run(moveBlockAction(drag.id, dayId, null), "Moved").then(done);
    setDrag(null); setOver(null);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 300px) 1fr", gap: 16, alignItems: "start" }} className="stripboard">
      <section className="panel" aria-label="Unscheduled scenes" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag?.type === "block") { run(removeBlockAction(drag.id), "Unscheduled").then(done); setDrag(null); } }}>
        <div className="panel-head"><h2>Unscheduled</h2><span className="subtle">{unscheduled.length}</span></div>
        <div style={{ maxHeight: "70vh", overflow: "auto", padding: 8 }}>
          {unscheduled.map((s) => (
            <div key={s.id} className="card" draggable={canWrite} onDragStart={() => setDrag({ type: "scene", id: s.id })}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><strong className="mono">{s.number}</strong><span className="subtle" style={{ fontSize: 12 }}>{s.episode ?? ""}{s.estDurationMins ? ` · ${s.estDurationMins}m` : ""}</span></div>
              <div style={{ fontSize: 13 }}>{s.title}</div>
              {canWrite && days.length > 0 && <select className="select btn-sm" style={{ marginTop: 6, height: 28 }} aria-label={`Add scene ${s.number} to a day`} value="" disabled={pending} onChange={(e) => e.target.value && run(addSceneToDayAction(e.target.value, s.id), "Scheduled").then(done)}>
                <option value="">Add to day…</option>{days.map((d) => <option key={d.id} value={d.id}>{date(d.date, { short: true, weekday: true })}{d.dayNumber ? ` · Day ${d.dayNumber}` : ""}</option>)}
              </select>}
            </div>
          ))}
          {unscheduled.length === 0 && <p className="subtle" style={{ padding: 8 }}>All scenes are scheduled.</p>}
        </div>
      </section>
      <div className="board" style={{ gridAutoColumns: "minmax(220px, 1fr)" }}>
        {days.map((d) => (
          <div key={d.id} className="lane" data-drop={over === d.id} onDragOver={(e) => { e.preventDefault(); setOver(d.id); }} onDragLeave={() => setOver(null)} onDrop={() => drop(d.id)} aria-label={`Shoot day ${d.date}`}>
            <h3><Link href={`/schedule/day/${d.id}`}>{date(d.date, { short: true, weekday: true })}{d.dayNumber ? ` · D${d.dayNumber}` : ""}</Link>{d.errors > 0 && <span className="badge tone-bad">{d.errors}</span>}</h3>
            <div className="subtle" style={{ fontSize: 11, padding: "0 6px 6px" }}>{d.unit} · {d.status}{d.blocks.length ? ` · ${pages(d.eighths)} pgs · ${Math.floor(d.mins / 60)}h${String(d.mins % 60).padStart(2, "0")}` : ""}</div>
            {d.blocks.map((b) => (
              <div key={b.id} className="card" draggable={canWrite && !!b.sceneId} onDragStart={() => setDrag({ type: "block", id: b.id })}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><strong className="mono">{b.number ?? "—"}</strong><span className="mono subtle" style={{ fontSize: 12 }}>{time(b.start)}</span></div>
                <div style={{ fontSize: 13 }}>{b.title}</div>
              </div>
            ))}
            {d.blocks.length === 0 && <div className="subtle" style={{ fontSize: 12, padding: 6 }}>Drop scenes here</div>}
          </div>
        ))}
        {canWrite && (
          <form className="lane" style={{ minHeight: 0 }} onSubmit={(e) => { e.preventDefault(); if (newDate) run(createRecord("shoot_days", { productionId, date: newDate, dayNumber: days.length + 1, generalCall: "08:00" }), "Shoot day created").then((r) => { setNewDate(""); done(r); }); }}>
            <h3>New shoot day</h3>
            <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New shoot day date" required />
            <button className="btn btn-primary" style={{ marginTop: 8, width: "100%" }} disabled={!newDate || pending}>Add day</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Script pages in industry eighths notation, e.g. 3 4/8. */
function pages(eighths: number) { const w = Math.floor(eighths / 8), r = eighths % 8; return r ? `${w ? `${w} ` : ""}${r}/8` : String(w); }
