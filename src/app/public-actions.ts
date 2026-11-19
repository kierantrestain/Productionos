"use server";
/** Unauthenticated actions. Each one is narrowly scoped and throttled in its service. */
import { toResult } from "@/server/errors";
import { submitPublicForm } from "@/server/platform/public-form";

export async function submitPublicFormAction(token: string, values: Record<string, unknown>) {
  return toResult(async () => { await submitPublicForm(token, values); return true; });
}
