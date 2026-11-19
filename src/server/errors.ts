export type AppErrorCode = "unauthenticated" | "forbidden" | "not_found" | "validation" | "conflict" | "blocked";

export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}
export const forbidden = (m = "You do not have permission to do that.") => new AppError("forbidden", m);
export const notFound = (m = "Record not found.") => new AppError("not_found", m);
export const invalid = (m: string, d?: unknown) => new AppError("validation", m, d);
export const conflict = (m: string) => new AppError("conflict", m);
export const blocked = (m: string) => new AppError("blocked", m);

/** Serialisable result for server actions. */
export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code: AppErrorCode | "internal"; details?: unknown };

export async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, code: e.code, details: e.details };
    const pg = (e as { cause?: unknown })?.cause ?? e;
    const err = pg as { code?: string; constraint_name?: string };
    if (err?.code === "23505") return { ok: false, error: "That would create a duplicate record.", code: "conflict", details: err.constraint_name };
    if (err?.code === "23514") return { ok: false, error: "A value is outside the allowed range.", code: "validation", details: err.constraint_name };
    console.error(e);
    return { ok: false, error: "Something went wrong. The change was not saved.", code: "internal" };
  }
}
