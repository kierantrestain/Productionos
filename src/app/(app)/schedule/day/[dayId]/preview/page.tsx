import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/auth/request";
import { buildSnapshot } from "@/server/services/callsheets";
import { CallSheetView } from "@/components/callsheet-view";
import { PrintButton } from "@/components/print-button";

export default async function PreviewPage({ params }: { params: Promise<{ dayId: string }> }) {
  const ctx = await requirePageContext();
  const { dayId } = await params;
  const s = await buildSnapshot(ctx, dayId).catch(() => null);
  if (!s) notFound();
  return (<><div className="row no-print" style={{ marginBottom: 12 }}><Link className="btn" href={`/schedule/day/${dayId}`}>← Back to Shoot-Day Command</Link><PrintButton /><span className="badge tone-warn">Preview — issue a version to distribute</span></div><CallSheetView s={s} live /></>);
}
