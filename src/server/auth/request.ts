import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { contextFromToken, SESSION_COOKIE } from "./sessions";
import type { Ctx } from "./context";
import { AppError } from "../errors";

/** Resolve the signed-in user for this request (memoised per request). */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  return contextFromToken(jar.get(SESSION_COOKIE)?.value);
});

/** For pages: redirect to sign-in when there is no session. */
export async function requirePageContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For server actions / route handlers: throw when unauthenticated. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) throw new AppError("unauthenticated", "Your session has expired. Please sign in again.");
  return ctx;
}
