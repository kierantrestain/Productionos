"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { entityLabels, withOrgOptions, type CustomFieldDefShape, type OrgSettingsShape } from "@/lib/customise";
import { getEntity, type FieldDef } from "@/lib/entities";

type Config = { settings: OrgSettingsShape; customFields: CustomFieldDefShape[] };
const OrgConfig = createContext<Config>({ settings: {}, customFields: [] });

export function OrgConfigProvider({ value, children }: { value: Config; children: ReactNode }) {
  return <OrgConfig.Provider value={value}>{children}</OrgConfig.Provider>;
}
export const useOrgConfig = () => useContext(OrgConfig);

/** Custom field definition rendered through the standard FieldInput. */
export function customAsField(c: CustomFieldDefShape): FieldDef {
  const type = c.type === "number" ? "int" : c.type;
  return { key: c.key, label: c.label, type: type as FieldDef["type"], options: c.options, required: c.required, help: c.help ?? undefined };
}

export function useEntityConfig(entity: string) {
  const c = useContext(OrgConfig);
  return useMemo(() => {
    const d = getEntity(entity)!;
    return { d, fields: withOrgOptions(c.settings, d), labels: entityLabels(c.settings, d), custom: c.customFields.filter((f) => f.entity === entity), settings: c.settings };
  }, [c, entity]);
}
