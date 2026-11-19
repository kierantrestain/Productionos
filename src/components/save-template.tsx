"use client";
import { useRouter } from "next/navigation";
import { saveAsTemplateAction } from "@/app/actions";
import { useRun } from "./client";

/** Capture this production's structure as an organisation template. */
export function SaveTemplateButton({ productionId, title }: { productionId: string; title: string }) {
  const router = useRouter();
  const { run, pending } = useRun();
  return <button className="btn" disabled={pending} onClick={async () => {
    const name = prompt("Template name", `${title} format`);
    if (!name) return;
    if (await run(saveAsTemplateAction(productionId, name), "Saved — it now appears under New production")) router.refresh();
  }}>Save as template</button>;
}
