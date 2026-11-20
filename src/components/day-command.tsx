"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { date, dateTime, humanize, time } from "@/lib/format";
import {
  addBlockAction, addSceneToDayAction, checkInAction, issueCallSheetAction, moveBlockAction, prepareDistributionAction,
  removeBlockAction, removeCallAction, syncCallsAction, updateBlockAction, upsertCallAction, wrapDayAction,
} from "@/app/actions";
import type { Conflict } from "@/server/services/conflicts";
import type { CallSheetSnapshot } from "@/server/services/callsheets";
import { Drawer, RefSelect, useRun } from "./client";
import { Icon } from "./icons";
import { alertDialog, confirmDialog, promptDialog } from "@/components/ui/dialogs";

export interface DayData {
  day: { id: string; date: string; dayNumber: number | null; unit: string; status: string; generalCall: string | null; estWrap: string | null; productionId: string; notes: string | null };
  production: { id: string; title: string };
  base: { name: string; address: string | null; postcode: string | null; parking: string | null } | null;
  blocks: { id: string; kind: string; sceneId: string | null; label: string | null; startTime: string | null; endTime: string | null; sceneNumber: string | null; sceneTitle: string | null; intExt: string | null; dayNight: string | null; location: string | null; cast: string[]; requirements: string[] }[];
  calls: { id: string; personId: string; name: string; roleType: string; roleTitle: string | null; callTime: string | null; onSetTime: string | null; pickupTime: string | null; confirmed: boolean; checkedInAt: string | null }[];
  conflicts: Conflict[];
  snapshot: CallSheetSnapshot;
  callSheets: { id: string; versionNumber: number; status: string; issuedAt: string | null; snapshotHash: string; notes: string | null }[];
  unscheduled: { id: string; number: string; title: string; estDurationMins: number | null }[];
  otherDays: { id: string; date: string; dayNumber: number | null }[];
  canWrite: boolean; canCheckIn: boolean;
}

const TABS = ["schedule", "cast", "crew", "locations", "kit", "logistics", "callsheets"] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { schedule: "Schedule", cast: "Cast & guests", crew: "Crew", locations: "Locations", kit: "Props, wardrobe & kit", logistics: "Transport & catering", callsheets: "Call sheets" };

export function DayCommand({ data, logistics }: { data: DayData; logistics: ReactNode }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [tab, setTab] = useState<(typeof TABS)[number]>("schedule");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNotes, setIssueNotes] = useState("");
  const [ack, setAck] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [addPerson, setAddPerson] = useState<string | null>(null);
  const { day } = data;
  const errors = data.conflicts.filter((c) => c.severity === "error");
  const warnings = data.conflicts.filter((c) => c.severity === "warning");
  const refresh = (r: unknown) => { if (r !== undefined) router.refresh(); };
  const castCalls = data.calls.filter((c) => c.roleType !== "crew");
  const crewCalls = data.calls.filter((c) => c.roleType === "crew");
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  const isToday = day.date === new Date().toISOString().slice(0, 10);
  const current = isToday ? data.blocks.find((b) => b.startTime && b.endTime && toMin(b.startTime) <= nowMin && nowMin < toMin(b.endTime)) : undefined;
  const latest = data.callSheets.find((c) => c.status === "issued");

  const moveTo = (blockId: string, beforeId: string | null) => run(moveBlockAction(blockId, day.id, beforeId)).then(refresh);
  const idx = (id: string) => data.blocks.findIndex((b) => b.id === id);

  return (
    <div>
      <div className="day-hero">
        <div>
          <div className="lbl">{data.production.title} · {day.unit}</div>
          <div className="date">{date(day.date, { weekday: true })}</div>
          <div style={{ opacity: .8, marginTop: 4 }}>{day.dayNumber ? `Day ${day.dayNumber}` : "Shoot day"} · <span style={{ textTransform: "capitalize" }}>{day.status}</span>{latest ? ` · call sheet v${latest.versionNumber} issued` : " · no call sheet issued"}</div>
        </div>
        <div>
          {current ? <div><div className="lbl"><span className="tally" /> On set now</div><div style={{ fontSize: 18, fontWeight: 650 }}>{current.sceneNumber ? `Sc ${current.sceneNumber} · ` : ""}{current.sceneTitle ?? current.label}</div></div>
            : data.base ? <div><div className="lbl">Unit base</div><div style={{ fontWeight: 600 }}>{data.base.name}</div><div style={{ opacity: .75, fontSize: 13 }}>{[data.base.address, data.base.postcode].filter(Boolean).join(", ")}</div></div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="lbl">General call</div><div className="call">{time(day.generalCall)}</div>
          <div className="lbl" style={{ marginTop: 4 }}>Est. wrap {time(day.estWrap)}</div>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) ? (
        <section className="panel" style={{ marginBottom: 16, borderColor: errors.length ? "var(--bad)" : "var(--warn)" }} aria-label="Conflicts" aria-live="polite">
          <div className="panel-head"><h2>{errors.length ? `${errors.length} blocking conflict${errors.length > 1 ? "s" : ""}` : "No blocking conflicts"}{warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}</h2><span className="subtle" style={{ fontSize: 12 }}>Recalculated on every change, across all productions</span></div>
          <ul className="list">{data.conflicts.map((c, i) => (
            <li key={i}><span className={`badge ${c.severity === "error" ? "tone-bad" : "tone-warn"}`}>{humanize(c.type)}</span><span style={{ flex: 1 }}>{c.message}</span>
              {c.entityType && c.entityId && c.entityType !== "schedule_blocks" && <Link className="btn btn-quiet btn-sm" href={`/data/${c.entityType}/${c.entityId}`}>Open</Link>}</li>))}
          </ul>
        </section>
      ) : <div className="notice ok" style={{ marginBottom: 16 }}>No conflicts detected for this day.</div>}

      <nav className="tabs" aria-label="Shoot day sections" role="tablist">
        {TABS.map((t) => <a key={t} href={`#${t}`} role="tab" aria-selected={tab === t} aria-current={tab === t ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(t); }}>{TAB_LABEL[t]}<span className="count">{t === "schedule" ? data.blocks.length : t === "cast" ? castCalls.length : t === "crew" ? crewCalls.length : t === "callsheets" ? data.callSheets.length : t === "locations" ? data.snapshot.locations.length : ""}</span></a>)}
      </nav>

      {tab === "schedule" && (
        <div className="grid-2">
          <section className="panel" aria-label="Running order">
            <div className="panel-head"><h2>Running order</h2>{data.canWrite && <span className="subtle" style={{ fontSize: 12 }}>Drag strips or use ↑↓ · times save on change</span>}</div>
            {data.blocks.length === 0 ? <div className="empty"><h3>Nothing scheduled</h3><p className="muted">Add scenes or segments from the list.</p></div> : data.blocks.map((b, i) => (
              <div key={b.id} className={`strip kind-${b.kind}`} draggable={data.canWrite} onDragStart={() => setDragId(b.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId && dragId !== b.id) moveTo(dragId, b.id); setDragId(null); }}>
                <div className="sc">{b.sceneNumber ?? <Icon name={b.kind === "meal" ? "clock" : "grip"} />}</div>
                <div className="time">
                  {data.canWrite ? <>
                    <input aria-label="Start time" className="input cell-edit mono" type="time" defaultValue={time(b.startTime) === "—" ? "" : time(b.startTime)} onBlur={(e) => e.target.value !== (b.startTime ?? "").slice(0, 5) && run(updateBlockAction(b.id, { startTime: e.target.value || null })).then(refresh)} />
                    <input aria-label="End time" className="input cell-edit mono" type="time" style={{ marginTop: 2 }} defaultValue={time(b.endTime) === "—" ? "" : time(b.endTime)} onBlur={(e) => e.target.value !== (b.endTime ?? "").slice(0, 5) && run(updateBlockAction(b.id, { endTime: e.target.value || null })).then(refresh)} />
                  </> : <>{time(b.startTime)}<br />{time(b.endTime)}</>}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{b.sceneId ? <Link href={`/productions/${day.productionId}/scenes/${b.sceneId}`}>{b.sceneTitle}</Link> : b.label ?? humanize(b.kind)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{[b.intExt, b.dayNight, b.location].filter(Boolean).join(" · ")}</div>
                  {b.cast.length > 0 && <div style={{ fontSize: 12 }}><span className="subtle">Cast:</span> {b.cast.join(", ")}</div>}
                  {b.requirements.length > 0 && <div className="subtle" style={{ fontSize: 12 }}>{b.requirements.join(" · ")}</div>}
                </div>
                {data.canWrite && <div className="row" style={{ flexWrap: "nowrap", gap: 2 }}>
                  <button className="btn btn-quiet btn-sm icon-btn" aria-label="Move earlier" disabled={i === 0 || pending} onClick={() => moveTo(b.id, data.blocks[i - 1].id)}><Icon name="up" size={14} /></button>
                  <button className="btn btn-quiet btn-sm icon-btn" aria-label="Move later" disabled={i === data.blocks.length - 1 || pending} onClick={() => moveTo(b.id, data.blocks[i + 2]?.id ?? null)}><Icon name="down" size={14} /></button>
                  <select className="select btn-sm" style={{ width: 34, padding: 0 }} aria-label="Move to another day" value="" onChange={(e) => e.target.value && run(moveBlockAction(b.id, e.target.value, null)).then(refresh)}>
                    <option value="">⇄</option>{data.otherDays.map((d) => <option key={d.id} value={d.id}>{date(d.date, { short: true })}{d.dayNumber ? ` (Day ${d.dayNumber})` : ""}</option>)}
                  </select>
                  <button className="btn btn-quiet btn-sm icon-btn btn-danger" aria-label="Remove from day" onClick={async () => idx(b.id) >= 0 && (await confirmDialog("Remove this block from the day?", { danger: true, confirmLabel: "Remove" })) && run(removeBlockAction(b.id)).then(refresh)}><Icon name="x" size={14} /></button>
                </div>}
              </div>
            ))}
          </section>
          <div className="stack">
            {data.canWrite && <section className="panel" aria-label="Add to schedule">
              <div className="panel-head"><h2>Unscheduled</h2><span className="subtle" style={{ fontSize: 12 }}>{data.unscheduled.length}</span></div>
              <ul className="list" style={{ maxHeight: 320, overflow: "auto" }}>
                {data.unscheduled.map((s) => (
                  <li key={s.id}><span className="mono" style={{ fontWeight: 700, width: 40 }}>{s.number}</span><span style={{ flex: 1, minWidth: 0 }}>{s.title}<span className="subtle" style={{ fontSize: 12 }}>{s.estDurationMins ? ` · ${s.estDurationMins}m` : ""}</span></span>
                    <button className="btn btn-sm" disabled={pending} onClick={() => run(addSceneToDayAction(day.id, s.id), `Scene ${s.number} scheduled`).then(refresh)}>Add</button></li>))}
                {data.unscheduled.length === 0 && <li className="subtle">Every scene is scheduled.</li>}
              </ul>
              <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
                {(["meal", "travel", "setup", "company_move"] as const).map((k) => <button key={k} className="btn btn-sm" onClick={async () => { const label = (await promptDialog(`${humanize(k)} label`, humanize(k))); if (label !== null) run(addBlockAction(day.id, k, label)).then(refresh); }}>+ {humanize(k)}</button>)}
              </div>
            </section>}
            <section className="panel" aria-label="Day actions"><div className="panel-head"><h2>Day actions</h2></div>
              <div className="panel-body stack" style={{ gap: 8 }}>
                {data.canWrite && <button className="btn btn-primary btn-lg" onClick={() => { setAck(false); setIssueOpen(true); }}><Icon name="file" /> Issue call sheet v{(data.callSheets[0]?.versionNumber ?? 0) + 1}</button>}
                <Link className="btn btn-lg" href={`/schedule/day/${day.id}/preview`}><Icon name="printer" /> Preview live call sheet</Link>
                {data.canWrite && day.status !== "wrapped" && <button className="btn" disabled={pending || !data.blocks.some((b) => b.sceneId)} onClick={async () => (await confirmDialog("Wrap this day? Scheduled scenes become “shot” and ingest/edit tasks are created in post.")) && run(wrapDayAction(day.id), "Handed over to post").then(refresh)}>Wrap & hand over to post</button>}
                {day.status === "wrapped" && <div className="notice ok">Wrapped — post tasks created. <Link href={`/post?production=${day.productionId}`}>Open post</Link></div>}
              </div></section>
          </div>
        </div>
      )}

      {(tab === "cast" || tab === "crew") && (
        <section className="panel" aria-label={TAB_LABEL[tab]}>
          <div className="panel-head"><h2>{TAB_LABEL[tab]}</h2>
            {data.canWrite && <div className="actions"><button className="btn btn-sm" onClick={() => run(syncCallsAction(day.id), "Call list synced from scheduled scenes").then(refresh)}>Sync from scenes</button></div>}
          </div>
          <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: "none" }}>
            <table className="data">
              <thead><tr><th>Name</th><th>Role</th><th>Call</th><th>On set</th><th>Pickup</th><th>Confirmed</th><th>Check-in</th>{data.canWrite && <th />}</tr></thead>
              <tbody>
                {(tab === "cast" ? castCalls : crewCalls).map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 560 }}><Link href={`/data/people/${c.personId}`}>{c.name}</Link></td>
                    <td>{data.canWrite ? <input className="input cell-edit" defaultValue={c.roleTitle ?? ""} aria-label={`Role for ${c.name}`} onBlur={(e) => e.target.value !== (c.roleTitle ?? "") && run(upsertCallAction(day.id, c.personId, { roleTitle: e.target.value || null })).then(refresh)} /> : c.roleTitle ?? humanize(c.roleType)}</td>
                    {(["callTime", "onSetTime", "pickupTime"] as const).map((k) => (
                      <td key={k}>{data.canWrite ? <input className="input cell-edit mono" type="time" style={{ width: 110 }} aria-label={`${k} for ${c.name}`} defaultValue={c[k]?.slice(0, 5) ?? ""} onBlur={(e) => e.target.value !== (c[k]?.slice(0, 5) ?? "") && run(upsertCallAction(day.id, c.personId, { [k]: e.target.value || null })).then(refresh)} /> : <span className="mono">{time(c[k])}</span>}</td>
                    ))}
                    <td><input type="checkbox" checked={c.confirmed} disabled={!data.canWrite} aria-label={`Confirmed ${c.name}`} onChange={(e) => run(upsertCallAction(day.id, c.personId, { confirmed: e.target.checked })).then(refresh)} /></td>
                    <td>{data.canCheckIn ? <button className={`btn btn-sm ${c.checkedInAt ? "" : "btn-primary"}`} onClick={() => run(checkInAction(c.id, !!c.checkedInAt)).then(refresh)}>{c.checkedInAt ? `✓ ${new Date(c.checkedInAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Check in"}</button> : c.checkedInAt ? "✓" : "—"}</td>
                    {data.canWrite && <td><button className="btn btn-quiet btn-sm btn-danger" aria-label={`Remove ${c.name}`} onClick={async () => (await confirmDialog(`Remove ${c.name} from the call list?`, { danger: true, confirmLabel: "Remove" })) && run(removeCallAction(c.id)).then(refresh)}><Icon name="x" size={14} /></button></td>}
                  </tr>
                ))}
                {(tab === "cast" ? castCalls : crewCalls).length === 0 && <tr><td colSpan={8}><div className="empty" style={{ padding: 16 }}>No one on the {tab} call list yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
          {data.canWrite && <form className="row" style={{ padding: 12, borderTop: "1px solid var(--border)", flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (addPerson) run(upsertCallAction(day.id, addPerson, { roleType: tab === "crew" ? "crew" : "cast" }), "Added to call list").then((r) => { setAddPerson(null); refresh(r); }); }}>
            <RefSelect entity="people" value={addPerson} onChange={setAddPerson} />
            <button className="btn" disabled={!addPerson}>Add to {tab} call</button>
          </form>}
        </section>
      )}

      {tab === "locations" && (
        <div className="grid-halves">
          {data.snapshot.locations.length === 0 && <div className="panel"><div className="empty">No locations on this day. Set a unit base or scene locations.</div></div>}
          {data.snapshot.locations.map((l) => (
            <section key={l.name} className="panel" aria-label={l.name}><div className="panel-head"><h2>{l.name}</h2></div>
              <div className="panel-body"><dl className="kv">
                <dt>Address</dt><dd>{[l.address, l.postcode].filter(Boolean).join(", ") || "—"}</dd>
                {l.what3words && <><dt>what3words</dt><dd className="mono">{l.what3words}</dd></>}
                <dt>Parking</dt><dd>{l.parking ?? "—"}</dd>
                <dt>Access</dt><dd>{l.access ?? "—"}</dd>
                <dt>Nearest A&amp;E</dt><dd>{l.hospital ?? "—"}</dd>
              </dl>{(l.address || l.postcode) && <a className="btn btn-sm" style={{ marginTop: 12 }} target="_blank" rel="noreferrer noopener" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.address, l.postcode].filter(Boolean).join(", "))}`}>Open in maps</a>}</div>
            </section>))}
        </div>
      )}

      {tab === "kit" && (
        <section className="panel" aria-label="Requirements"><div className="panel-head"><h2>Requirements by scene</h2></div>
          <ul className="list">{data.blocks.filter((b) => b.requirements.length).map((b) => <li key={b.id} style={{ alignItems: "flex-start" }}><strong className="mono" style={{ width: 48 }}>{b.sceneNumber}</strong><div>{b.requirements.map((r) => <div key={r}>{r}</div>)}</div></li>)}
            {!data.blocks.some((b) => b.requirements.length) && <li className="subtle">No props, wardrobe or equipment linked to today’s scenes.</li>}</ul>
        </section>
      )}

      {tab === "logistics" && logistics}

      {tab === "callsheets" && (
        <section className="panel" aria-label="Call sheet versions"><div className="panel-head"><h2>Issued versions</h2><span className="subtle" style={{ fontSize: 12 }}>Issued versions are immutable snapshots</span></div>
          <ul className="list">
            {data.callSheets.map((c) => (
              <li key={c.id}><strong>v{c.versionNumber}</strong><span className={`badge ${c.status === "issued" ? "tone-ok" : ""}`}>{humanize(c.status)}</span><span className="muted" style={{ flex: 1 }}>{dateTime(c.issuedAt)}{c.notes ? ` · ${c.notes}` : ""}</span>
                <span className="subtle mono" style={{ fontSize: 11 }} title={c.snapshotHash}>{c.snapshotHash.slice(0, 10)}</span>
                <Link className="btn btn-sm" href={`/callsheets/${c.id}`}><Icon name="printer" size={14} /> Open</Link>
                {c.status === "issued" && data.canWrite && <button className="btn btn-sm" onClick={() => run(prepareDistributionAction(c.id)).then(async (r) => { if (r) { (await alertDialog(`${r.created} message draft(s) prepared for review in Automations → Outbox. ${r.missingEmail} recipient(s) have no email. Nothing has been sent.`)); router.refresh(); } })}>Prepare distribution</button>}
              </li>))}
            {data.callSheets.length === 0 && <li className="subtle">No call sheet has been issued for this day.</li>}
          </ul>
        </section>
      )}

      <Drawer open={issueOpen} onClose={() => setIssueOpen(false)} title={`Issue call sheet v${(data.callSheets[0]?.versionNumber ?? 0) + 1}`} modal
        footer={<><button className="btn" onClick={() => setIssueOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={pending || (errors.length > 0 && !ack)} onClick={() => run(issueCallSheetAction(day.id, issueNotes, ack), "Call sheet issued").then((r) => { if (r) { setIssueOpen(false); setIssueNotes(""); router.push(`/callsheets/${r.id}`); } })}>Issue version</button></>}>
        <div className="stack" style={{ gap: 12 }}>
          <p>This freezes the current plan — {data.blocks.length} blocks, {data.calls.length} calls — as an immutable version. Later schedule changes will not alter it; issue a new version instead.</p>
          {errors.length > 0 && <label className="check notice bad"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I acknowledge {errors.length} unresolved blocking conflict(s); they will be printed on the sheet.</label>}
          <div className="field"><label htmlFor="issue-notes">Revision notes</label><textarea id="issue-notes" className="textarea" value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="e.g. Running order revised; Round 2 moved to 10:15" /></div>
        </div>
      </Drawer>
    </div>
  );
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
