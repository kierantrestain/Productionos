"use client";
import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions";
export function InviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <input type="hidden" name="token" value={token} />
      <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" required className="input" /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
      {state?.error && <div className="notice bad" role="alert">{state.error}</div>}
      <button className="btn btn-primary btn-lg" disabled={pending}>Create account</button>
    </form>
  );
}
