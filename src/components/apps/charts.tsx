"use client";
import { useState } from "react";

/** Chart primitives for app pages. Single-measure charts use one hue; donuts use the validated categorical order. */
export type Point = { label: string; value: number };
const SLOTS = 8;
const vizColor = (i: number) => (i < SLOTS ? `var(--viz-${i + 1})` : "var(--viz-other)");

export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const on = (text: string) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX + 12, y: e.clientY + 12, text }), onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => { const r = (e.target as Element).getBoundingClientRect(); setTip({ x: r.right + 6, y: r.top, text }); }, onBlur: () => setTip(null),
    tabIndex: 0, "aria-label": text,
  });
  return { on, node: tip ? <div className="if-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null };
}

export function BarChart({ data, fmt, short, onSelect }: { data: Point[]; fmt: (n: number) => string; short: (n: number) => string; onSelect?: (label: string) => void }) {
  const tip = useTip();
  const W = 520, H = 220, P = { l: 44, r: 8, t: 22, b: 30 };
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const nice = niceMax(max);
  const bw = Math.min(90, ((W - P.l - P.r) / Math.max(data.length, 1)) * 0.62);
  const x = (i: number) => P.l + ((i + 0.5) * (W - P.l - P.r)) / Math.max(data.length, 1);
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / nice);
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart">
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-secondary)">{short(t)}</text></g>)}
        {data.map((d, i) => {
          const h = Math.max(2, y(0) - y(d.value));
          return (
            <g key={d.label} style={{ cursor: onSelect ? "pointer" : undefined }} onClick={() => onSelect?.(d.label)}>
              <path className="if-bar" d={roundTop(x(i) - bw / 2, y(d.value), bw, h, 4)} fill="var(--viz-1)" {...tip.on(`${d.label}: ${fmt(d.value)}`)} />
              {h > 24 && <text x={x(i)} y={y(d.value) + 18} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{short(d.value)}</text>}
              <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-text-secondary)">{d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}</text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </>
  );
}

export function LineChart({ data, fmt, short }: { data: Point[]; fmt: (n: number) => string; short: (n: number) => string }) {
  const tip = useTip();
  const W = 520, H = 200, P = { l: 44, r: 12, t: 12, b: 28 };
  const nice = niceMax(Math.max(...data.map((d) => d.value), 0) || 1);
  const x = (i: number) => P.l + (data.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (data.length - 1));
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / nice);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Line chart">
        {[0, nice / 2, nice].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-secondary)">{short(t)}</text></g>)}
        <polyline fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" points={data.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {data.map((p, i) => <circle key={p.label} cx={x(i)} cy={y(p.value)} r={4} fill="var(--viz-1)" stroke="var(--color-background-card)" strokeWidth={2} {...tip.on(`${p.label}: ${fmt(p.value)}`)} />)}
        {data.map((p, i) => (data.length <= 8 || i % Math.ceil(data.length / 8) === 0) && <text key={`l${p.label}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-text-secondary)">{p.label}</text>)}
      </svg>
      {tip.node}
    </>
  );
}

export function DonutChart({ data, fmt, short }: { data: Point[]; fmt: (n: number) => string; short: (n: number) => string }) {
  const tip = useTip();
  const top = data.length > SLOTS ? [...data.slice(0, SLOTS - 1), { label: "Other", value: data.slice(SLOTS - 1).reduce((a, b) => a + b.value, 0) }] : data;
  const total = top.reduce((a, b) => a + b.value, 0) || 1;
  const R = 70, r = 46, C = 80; let a0 = -Math.PI / 2;
  const pt = (rad: number, ang: number) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
  const colorOf = (i: number, label: string) => (label === "Other" && data.length > SLOTS ? "var(--viz-other)" : vizColor(i));
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox="0 0 160 160" width={160} height={160} role="img" aria-label="Donut chart">
        {top.map((p, i) => {
          const a1 = a0 + (2 * Math.PI * p.value) / total; const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = p.value >= total ? `M ${pt(R, 0)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI)} A ${R} ${R} 0 1 1 ${pt(R, 0)} M ${pt(r, 0)} A ${r} ${r} 0 1 0 ${pt(r, Math.PI)} A ${r} ${r} 0 1 0 ${pt(r, 0)}` : `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
          a0 = a1;
          return <path key={p.label} className="if-arc" d={d} fill={colorOf(i, p.label)} stroke="var(--color-background-card)" strokeWidth={2} fillRule="evenodd" {...tip.on(`${p.label}: ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`)} />;
        })}
        <text x={C} y={C - 2} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--color-text-primary)">{short(total)}</text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)">Total</text>
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13, display: "grid", gap: 6, minWidth: 0 }}>
        {top.map((p, i) => <li key={p.label} style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(i, p.label), flex: "none" }} /><span>{p.label} <span style={{ color: "var(--color-text-secondary)" }}>({Math.round((p.value / total) * 100)}%)</span></span><span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", paddingLeft: 8 }}>{fmt(p.value)}</span></li>)}
      </ul>
      {tip.node}
    </div>
  );
}

function niceMax(v: number) { const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function roundTop(x: number, y: number, w: number, h: number, r: number) { const rr = Math.min(r, w / 2, h); return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`; }
