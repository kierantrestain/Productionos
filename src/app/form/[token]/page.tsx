import "../../platform.css";
import { notFound } from "next/navigation";
import { loadPublicForm } from "@/server/platform/public-form";
import { PublicForm } from "@/components/platform/public-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Form", robots: { index: false } };

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let f: Awaited<ReturnType<typeof loadPublicForm>>["form"];
  try { f = (await loadPublicForm(token)).form; } catch { notFound(); }
  return <PublicForm token={token} form={{ ...f, fields: f.fields.map((x) => ({ ...x, f: { ...x.f, tableId: "", editable: true, isPrimary: false } })) }} />;
}
