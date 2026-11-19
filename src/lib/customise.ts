/**
 * Organisation customisation contract, shared by server (validation) and client (rendering).
 * Status-like fields drive server logic (approvals, delivery gates, conflicts), so their option
 * lists are locked; every other select can be extended by an org admin.
 */
import type { EntityDef, FieldDef } from "./entities";
import { humanize } from "./entities";

export interface OrgSettingsShape {
  currency?: string;
  timezone?: string;
  defaultVatBp?: number;
  approval?: { pmLimitMinor?: number; producerLimitMinor?: number };
  callSheetContactPolicy?: string;
  terminology?: Record<string, { label?: string; plural?: string }>;
  options?: Record<string, string[]>;
  departments?: string[];
}

export interface CustomFieldDefShape {
  id: string; entity: string; key: string; label: string;
  type: "text" | "textarea" | "number" | "money" | "date" | "bool" | "select" | "url";
  options: string[]; required: boolean; showInList: boolean; sortOrder: number; help: string | null;
}

export const CUSTOM_FIELD_TYPES = ["text", "textarea", "number", "money", "date", "bool", "select", "url"] as const;
export const LOCKED_SELECT_KEYS = new Set(["status", "stage", "contractStatus", "ingestStatus", "priority", "migrationStatus"]);
export const DEFAULT_CONTACT_POLICY = "Personal phone numbers and addresses are not printed. Contact cast and crew through the production office.";
export const DEFAULT_APPROVAL = { pmLimitMinor: 100_000, producerLimitMinor: 1_000_000 };

export function isExtensible(f: FieldDef) {
  return f.type === "select" && !f.readOnly && !f.system && !LOCKED_SELECT_KEYS.has(f.key);
}

/** Built-in options plus org additions (stored as snake_case values). */
export function mergedOptions(settings: OrgSettingsShape | undefined, entity: string, f: FieldDef): string[] {
  const base = [...(f.options ?? [])];
  if (!isExtensible(f)) return base;
  for (const o of settings?.options?.[`${entity}.${f.key}`] ?? []) if (!base.includes(o)) base.push(o);
  return base;
}

export function withOrgOptions(settings: OrgSettingsShape | undefined, d: EntityDef): FieldDef[] {
  return d.fields.map((f) => (f.type === "select" ? { ...f, options: mergedOptions(settings, d.key, f) } : f));
}

export function entityLabels(settings: OrgSettingsShape | undefined, d: EntityDef) {
  const t = settings?.terminology?.[d.key];
  return { label: t?.label?.trim() || d.label, plural: t?.plural?.trim() || d.plural };
}

export const toOptionValue = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
export const optionLabel = (v: string) => humanize(v);
