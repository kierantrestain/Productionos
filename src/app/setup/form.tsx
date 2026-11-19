"use client";
import { useActionState } from "react";
import { setupAction } from "../actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <div className="field"><label htmlFor="orgName">Company / organisation</label><input id="orgName" name="orgName" required className="input" placeholder="Bang On Productions" /></div>
      <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" required className="input" autoComplete="name" /></div>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required className="input" autoComplete="username" /></div>
      <div className="field"><label htmlFor="password">Password (10+ characters)</label><input id="password" name="password" type="password" minLength={10} required className="input" autoComplete="new-password" /></div>
      <label className="check"><input type="checkbox" name="demo" defaultChecked /> Also create a separate, clearly labelled demo workspace with sample productions</label>
      {state?.error && <div className="notice bad" role="alert">{state.error}</div>}
      <button className="btn btn-primary btn-lg" disabled={pending}>{pending ? "Setting up… (up to 30 seconds with demo data)" : "Create workspace"}</button>
    </form>
  );
}
