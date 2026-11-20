import "../../platform.css";
import { notFound } from "next/navigation";
import { loadPublicForm } from "@/server/platform/public-form";
import { PublicForm } from "@/components/platform/public-form";
import { prefillFrom } from "@/lib/platform/form-logic";

export const dynamic = "force-dynamic";
export const metadata = { title: "Form", robots: { index: false } };

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params; const sp = await searchParams;
  let f: Awaited<ReturnType<typeof loadPublicForm>>["form"];
  try { f = (await loadPublicForm(token)).form; } catch { notFound(); }
  const initial = prefillFrom(sp, f.fields.flatMap((x) => [x.f.name, ...(x.label ? [x.label] : [])].map((name) => ({ fieldId: x.fieldId, name, type: x.f.type, choices: x.f.options?.choices }))));
  return <PublicForm token={token} initial={initial} form={{ ...f, fields: f.fields.map((x) => ({ ...x, f: { ...x.f, tableId: "", editable: true, isPrimary: false } })) }} />;
}
