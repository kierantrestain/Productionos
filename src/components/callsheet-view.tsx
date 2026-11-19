import type { CallSheetSnapshot } from "@/server/services/callsheets";
import { date, humanize } from "@/lib/format";

/** Print-optimised call sheet. Renders an immutable snapshot (or the live preview). */
export function CallSheetView({ s, version, issuedAt, hash, live }: { s: CallSheetSnapshot; version?: number; issuedAt?: string | null; hash?: string; live?: boolean }) {
  const groups = [["cast", "Cast & presenters"], ["guests", "Guests & contributors"], ["crew", "Crew"]] as const;
  return (
    <article className="stack" style={{ gap: 12 }} aria-label="Call sheet">
      <header className="panel"><div className="panel-body" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16 }}>
        <div>
          <div className="subtle" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>{live ? "Live preview — not issued" : `Call sheet · version ${version}`}</div>
          <h1 style={{ fontSize: 26 }}>{s.production.title}</h1>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{date(s.day.date, { weekday: true })} · {s.day.dayNumber ? `Day ${s.day.dayNumber}` : "Shoot day"} · {s.day.unit}</div>
          {issuedAt && <div className="subtle" style={{ fontSize: 12 }}>Issued {new Date(issuedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} · integrity {hash?.slice(0, 16)}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="subtle" style={{ fontSize: 11, textTransform: "uppercase" }}>General call</div>
          <div className="mono" style={{ fontSize: 32, fontWeight: 700 }}>{s.day.generalCall ?? "TBC"}</div>
          <div className="subtle">Est. wrap {s.day.estWrap ?? "TBC"}</div>
          {(s.day.sunrise || s.day.sunset) && <div className="subtle" style={{ fontSize: 12 }}>Sunrise {s.day.sunrise ?? "—"} · Sunset {s.day.sunset ?? "—"}</div>}
        </div>
      </div></header>
      {s.openIssues.filter((i) => i.severity === "error").length > 0 && <div className="notice bad">Unresolved conflicts at issue time: {s.openIssues.filter((i) => i.severity === "error").map((i) => i.message).join(" · ")}</div>}
      <div className="grid-halves">
        <section className="panel"><div className="panel-head"><h2>Unit base & safety</h2></div><div className="panel-body"><dl className="kv">
          <dt>Unit base</dt><dd>{s.base ? `${s.base.name}${s.base.address ? `, ${s.base.address}` : ""}${s.base.postcode ? ` ${s.base.postcode}` : ""}` : "—"}</dd>
          <dt>Parking</dt><dd>{s.base?.parking ?? s.day.unitBaseNotes ?? "—"}</dd>
          <dt>Nearest A&amp;E</dt><dd>{s.base?.hospital ?? s.locations.find((l) => l.hospital)?.hospital ?? "—"}</dd>
          <dt>Weather</dt><dd>{s.day.weatherNote ?? "—"}</dd>
          <dt>Safety</dt><dd style={{ whiteSpace: "pre-wrap" }}>{s.day.safetyNotes ?? "—"}</dd>
        </dl></div></section>
        <section className="panel"><div className="panel-head"><h2>Locations</h2></div><div className="panel-body stack" style={{ gap: 8 }}>
          {s.locations.length === 0 ? <span className="subtle">—</span> : s.locations.map((l) => <div key={l.name}><strong>{l.name}</strong><div className="muted" style={{ fontSize: 12 }}>{[l.address, l.postcode, l.what3words && `///${l.what3words}`].filter(Boolean).join(" · ")}</div>{l.access && <div style={{ fontSize: 12 }}>{l.access}</div>}</div>)}
        </div></section>
      </div>
      <section className="panel"><div className="panel-head"><h2>Schedule</h2></div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0, maxHeight: "none" }}><table className="data">
          <thead><tr><th>Time</th><th>Sc</th><th>Scene / segment</th><th>I/E · D/N</th><th>Location</th><th>Cast</th><th>Requirements</th></tr></thead>
          <tbody>{s.schedule.map((b, i) => (
            <tr key={i} style={b.kind !== "scene" ? { background: "var(--surface-2)" } : undefined}>
              <td className="mono">{b.start ?? "—"}–{b.end ?? ""}</td><td style={{ fontWeight: 700 }}>{b.sceneNumber ?? ""}</td>
              <td style={{ whiteSpace: "normal", fontWeight: b.kind === "scene" ? 560 : 400 }}>{b.title}{b.episode ? <span className="subtle"> · {b.episode}</span> : null}{b.notes ? <div className="subtle" style={{ fontSize: 12 }}>{b.notes}</div> : null}</td>
              <td>{[b.intExt, b.dayNight].filter(Boolean).join(" · ")}</td><td>{b.location ?? ""}</td>
              <td style={{ whiteSpace: "normal" }}>{b.cast.join(", ")}</td><td style={{ whiteSpace: "normal", fontSize: 12 }}>{b.requirements.join(", ")}</td>
            </tr>))}</tbody>
        </table></div>
      </section>
      <div className="grid-halves">
        {groups.map(([g, label]) => {
          const rows = s.calls.filter((c) => c.group === g);
          if (!rows.length) return null;
          return (
            <section key={g} className="panel"><div className="panel-head"><h2>{label}</h2><span className="subtle">{rows.length}</span></div>
              <table className="data"><thead><tr><th>Name</th><th>Role</th><th>Call</th><th>On set</th><th>Pickup</th></tr></thead>
                <tbody>{rows.map((c, i) => <tr key={i}><td style={{ fontWeight: 560 }}>{c.name}</td><td>{c.role ?? ""}</td><td className="mono">{c.call ?? s.day.generalCall ?? ""}</td><td className="mono">{c.onSet ?? ""}</td><td className="mono">{c.pickup ?? ""}</td></tr>)}</tbody></table>
            </section>);
        })}
      </div>
      {(s.transport.length > 0 || s.catering.length > 0) && <div className="grid-halves">
        {s.transport.length > 0 && <section className="panel"><div className="panel-head"><h2>Transport</h2></div><ul className="list">{s.transport.map((t, i) => <li key={i}><span className="mono">{t.pickup ?? ""}</span><span>{humanize(t.kind)}: {t.from} → {t.to}{t.driver ? ` · ${t.driver}` : ""}</span></li>)}</ul></section>}
        {s.catering.length > 0 && <section className="panel"><div className="panel-head"><h2>Catering</h2></div><ul className="list">{s.catering.map((c, i) => <li key={i}><span className="mono">{c.time ?? ""}</span><span>{humanize(c.meal)}{c.headcount ? ` · ${c.headcount} covers` : ""}{c.dietary ? ` · ${c.dietary}` : ""}</span></li>)}</ul></section>}
      </div>}
      {s.day.notes && <section className="panel"><div className="panel-head"><h2>Notes</h2></div><div className="panel-body" style={{ whiteSpace: "pre-wrap" }}>{s.day.notes}</div></section>}
      <p className="subtle" style={{ fontSize: 12 }}>{s.contactPolicy}</p>
    </article>
  );
}
