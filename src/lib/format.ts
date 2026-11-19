import { humanize } from "./entities";

export function money(minor: number | null | undefined, currency = "GBP", opts: { compact?: boolean } = {}) {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, notation: opts.compact ? "compact" : "standard", maximumFractionDigits: opts.compact ? 1 : 2 }).format(minor / 100);
}

export function date(d: string | null | undefined, opts: { weekday?: boolean; short?: boolean } = {}) {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T12:00:00Z` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return new Intl.DateTimeFormat("en-GB", { weekday: opts.weekday ? "short" : undefined, day: "numeric", month: "short", year: opts.short ? undefined : "numeric", timeZone: "Europe/London" }).format(dt);
}

export function dateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(d));
}

export const time = (t: string | null | undefined) => (t ? t.slice(0, 5) : "—");
export const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`);

const TONES: Record<string, string> = {
  // positive
  approved: "ok", signed: "ok", countersigned: "ok", cleared: "ok", confirmed: "ok", done: "ok", delivered: "ok", complete: "ok", wrapped: "ok",
  active: "ok", succeeded: "ok", sent: "ok", verified: "ok", met: "ok", won: "ok", released: "ok", greenlit: "ok", available: "ok", shot: "ok", paid: "ok", received: "ok", closed: "ok", issued: "ok", implemented: "ok", ingested: "ok", contracted: "ok",
  // live / in flight
  in_production: "live", production: "live", shooting: "live", in_progress: "live", doing: "live", scheduled: "live", queued: "live", running: "live", delivering: "live",
  // attention
  pending: "warn", pending_approval: "warn", submitted: "warn", in_review: "warn", review: "warn", ready_for_approval: "warn", awaiting_confirmation: "warn", hold: "warn", draft: "neutral", generated: "info",
  at_risk: "warn", mitigating: "warn", changes_requested: "warn", required: "warn", qc: "info", negotiating: "info", paused: "warn", superseded: "neutral", replaced: "info", mixed: "warn",
  // bad
  rejected: "bad", blocked: "bad", failed: "bad", dead: "bad", missing: "bad", expired: "bad", disputed: "bad", breached: "bad", refused: "bad", cancelled: "neutral", lost: "bad",
  maintenance: "warn", checked_out: "info", booked: "info", blocked_no_provider: "bad", open: "warn", urgent: "bad", high: "warn", must: "live", retired: "neutral", unavailable: "bad",
};
export function tone(v: string | null | undefined): string {
  if (!v) return "";
  const t = TONES[v];
  return t && t !== "neutral" ? `tone-${t}` : "";
}
export { humanize };
