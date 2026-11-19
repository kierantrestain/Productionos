import type { ReactNode } from "react";
import { getEntity } from "@/lib/entities";
import { canRead } from "@/lib/permissions";
import type { Ctx } from "@/server/auth/context";
import { EntityView, type SP } from "./entity-view";
import { Forbidden, PageHeader, Tabs } from "./ui";

export interface WsTab { key: string; label: string; entity?: string; fixed?: Record<string, string>; columns?: string[]; render?: () => Promise<ReactNode> | ReactNode; emptyHint?: string; recordBase?: string; readOnly?: boolean }

/** A workspace = header + tabs, each tab a live entity grid or a custom panel. Tabs the role cannot read are hidden. */
export async function Workspace({ ctx, sp, base, title, lede, tabs, actions, eyebrow }: { ctx: Ctx; sp: SP; base: string; title: ReactNode; lede?: ReactNode; tabs: WsTab[]; actions?: ReactNode; eyebrow?: ReactNode }) {
  // Apply organisation terminology to tabs that use the registry's default plural.
  tabs = tabs.map((t) => { const d = t.entity ? getEntity(t.entity) : undefined; const o = d && ctx.settings?.terminology?.[d.key]?.plural; return o && t.label === d!.plural ? { ...t, label: o } : t; });
  const visible = tabs.filter((t) => { if (!t.entity) return true; const d = getEntity(t.entity)!; return canRead(ctx.role, d.readDomain ?? d.domain); });
  if (!visible.length) return <><PageHeader title={title} /><div className="panel"><Forbidden /></div></>;
  const activeKey = typeof sp.tab === "string" && visible.some((t) => t.key === sp.tab) ? sp.tab : visible[0].key;
  const active = visible.find((t) => t.key === activeKey)!;
  return (
    <>
      <PageHeader title={title} lede={lede} actions={actions} eyebrow={eyebrow} />
      {visible.length > 1 && <Tabs tabs={visible.map((t) => ({ key: t.key, label: t.label }))} active={activeKey} base={base} />}
      {active.render ? await active.render() : <EntityView ctx={ctx} entity={active.entity!} sp={sp} fixed={active.fixed} columns={active.columns} emptyHint={active.emptyHint} recordBase={active.recordBase} readOnly={active.readOnly} />}
    </>
  );
}
