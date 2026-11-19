"use client";
import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <input type="hidden" name="next" value={next} />
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required className="input" style={{ height: 40 }} /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" style={{ height: 40 }} /></div>
      {state?.error && <div className="notice bad" role="alert">{state.error}</div>}
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
