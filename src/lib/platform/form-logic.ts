/**
 * Form logic shared by the form builder, the public form page and the server:
 * conditional visibility, required-only-when-visible validation, pages, prefill and open/closed state.
 * The server re-runs these checks — the browser is never trusted.
 */
export type FormItem = { fieldId: string; required?: boolean; help?: string; label?: string; placeholder?: string; pageBreak?: boolean; showIf?: { fieldId: string; op: "is" | "isNot" | "isNotEmpty" | "isEmpty" | "isChecked"; value?: string } };
export type FormSettings = { redirectUrl?: string; allowAnother?: boolean; closed?: boolean; closesAt?: string };

export const isBlank = (v: unknown) => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length);

/** Is this item shown, given current answers? Items whose condition points at a hidden item are hidden too. */
export function visibleItems(items: FormItem[], values: Record<string, unknown>): Set<string> {
  const shown = new Set<string>();
  for (const it of items) {
    const c = it.showIf;
    if (!c || !items.some((x) => x.fieldId === c.fieldId)) { shown.add(it.fieldId); continue; }
    if (!shown.has(c.fieldId)) continue;
    const v = values[c.fieldId];
    const ok = c.op === "isNotEmpty" ? !isBlank(v) : c.op === "isEmpty" ? isBlank(v) : c.op === "isChecked" ? v === true
      : c.op === "is" ? (Array.isArray(v) ? v.map(String).includes(String(c.value ?? "")) : String(v ?? "") === String(c.value ?? ""))
      : (Array.isArray(v) ? !v.map(String).includes(String(c.value ?? "")) : String(v ?? "") !== String(c.value ?? ""));
    if (ok) shown.add(it.fieldId);
  }
  return shown;
}

/** Split into pages at each item marked pageBreak (the break starts a new page). */
export function pagesOf(items: FormItem[]): FormItem[][] {
  const pages: FormItem[][] = [[]];
  for (const it of items) { if (it.pageBreak && pages[pages.length - 1].length) pages.push([]); pages[pages.length - 1].push(it); }
  return pages.filter((p) => p.length);
}

export function missingRequired(items: FormItem[], values: Record<string, unknown>, shown = visibleItems(items, values)) {
  return items.filter((it) => it.required && shown.has(it.fieldId) && isBlank(values[it.fieldId]));
}

/** Keep only answers to visible items (hidden answers are discarded, never stored). */
export function cleanAnswers(items: FormItem[], values: Record<string, unknown>) {
  const shown = visibleItems(items, values);
  return Object.fromEntries(Object.entries(values).filter(([k]) => shown.has(k)));
}

export function formClosed(s: FormSettings, now = new Date()) {
  return !!s.closed || (!!s.closesAt && !isNaN(+new Date(s.closesAt)) && new Date(s.closesAt) <= now);
}
export const safeRedirect = (u?: string) => (u && /^https?:\/\/[^\s]+$/i.test(u) ? u : undefined);

/** ?prefill_<Field name>=value (or prefill_<fieldId>) → initial answers for matching form items. */
export function prefillFrom(params: Record<string, string | string[] | undefined>, items: { fieldId: string; name: string; type: string; choices?: { id: string; name: string }[] }[]) {
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(params)) {
    if (!k.startsWith("prefill_") || raw === undefined) continue;
    const key = k.slice(8).toLowerCase().replace(/[_+]/g, " ").trim(); const v = String(Array.isArray(raw) ? raw[0] : raw).slice(0, 2000);
    const it = items.find((x) => x.fieldId.toLowerCase() === key || x.name.toLowerCase() === key);
    if (!it) continue;
    if (it.type === "singleSelect") { const c = it.choices?.find((x) => x.name.toLowerCase() === v.toLowerCase() || x.id === v); if (c) out[it.fieldId] = c.id; }
    else if (it.type === "multipleSelects") out[it.fieldId] = v.split(",").map((p) => it.choices?.find((x) => x.name.toLowerCase() === p.trim().toLowerCase())?.id).filter(Boolean);
    else if (it.type === "checkbox") out[it.fieldId] = /^(1|true|yes)$/i.test(v);
    else out[it.fieldId] = v;
  }
  return out;
}
