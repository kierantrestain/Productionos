import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";
import Link from "next/link";
import { canWrite } from "@/lib/permissions";

export const metadata = { title: "Productions" };

export default async function ProductionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  return <Workspace ctx={ctx} sp={await searchParams} base="/productions" title="Productions, seasons & episodes"
    lede="Series, films, commercials, documentaries and studio formats. Standalone productions work without seasons or episodes."
    actions={canWrite(ctx.role, "production") ? <Link className="btn btn-primary" href="/productions/new">New production from template</Link> : undefined}
    tabs={[
      { key: "productions", label: "Productions", entity: "productions", recordBase: "/productions" },
      { key: "seasons", label: "Seasons", entity: "seasons" },
      { key: "episodes", label: "Episodes & units", entity: "episodes" },
    ]} />;
}
