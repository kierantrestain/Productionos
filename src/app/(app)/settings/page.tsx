import { requirePageContext } from "@/server/auth/request";
import { extensibleSelects, getSettings, listFieldDefs } from "@/server/services/customise";
import { ENTITIES } from "@/lib/entities";
import { CustomFieldSettings, GeneralSettings, OptionListSettings, TerminologySettings } from "@/components/settings-client";
import { Forbidden, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Customise" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageContext();
  if (ctx.role !== "org_admin") return <Forbidden what="customisation" />;
  const tab = (await searchParams).tab ?? "general";
  const [settings, defs] = await Promise.all([getSettings(ctx), listFieldDefs(ctx)]);
  const entities = Object.values(ENTITIES).map((d) => ({ key: d.key, label: d.label, plural: d.plural })).sort((a, b) => a.plural.localeCompare(b.plural));
  return (
    <>
      <PageHeader title="Customise Production OS" lede="Shape the system around your productions: defaults and approval limits, your own terminology, extra choices in drop-downs, and custom fields on any record. Changes apply immediately and are audited." />
      <Tabs active={tab} base="/settings" tabs={[{ key: "general", label: "Defaults & approvals" }, { key: "fields", label: "Custom fields", count: defs.length }, { key: "options", label: "Option lists" }, { key: "terms", label: "Terminology" }]} />
      {tab === "general" && <GeneralSettings settings={settings} />}
      {tab === "fields" && <CustomFieldSettings defs={defs} entities={entities} />}
      {tab === "options" && <OptionListSettings settings={settings} lists={extensibleSelects()} />}
      {tab === "terms" && <TerminologySettings settings={settings} entities={entities} />}
    </>
  );
}
