import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { getCallSheet } from "@/server/services/callsheets";
import { CallSheetView } from "@/components/callsheet-view";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Call sheet" };

export default async function CallSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const cs = await getCallSheet(ctx, id).catch(() => null);
  if (!cs) notFound();
  const back = ctx.role === "cast" || ctx.role === "crew" ? "/my" : `/schedule/day/${cs.shootDayId}`;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <Link className="btn" href={back}>← Back</Link><PrintButton />
        {cs.status === "superseded" ? <span className="badge tone-warn">Superseded — a newer version exists</span> : <span className="badge tone-ok">Current issued version</span>}
      </div>
      <CallSheetView s={cs.snapshot} version={cs.versionNumber} issuedAt={cs.issuedAt?.toISOString()} hash={cs.snapshotHash} />
    </>
  );
}
