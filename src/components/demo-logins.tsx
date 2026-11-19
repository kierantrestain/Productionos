"use client";
import { useState } from "react";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { resetDemoLoginsAction } from "@/app/actions";
import { useRun } from "./client";

/** Demo workspace only: issue fresh sign-ins for every role so you can test what each person sees. */
export function DemoLogins() {
  const { run, pending } = useRun();
  const [res, setRes] = useState<{ password: string; accounts: { email: string; name: string; role: string }[] } | null>(null);
  return (
    <section className="panel" aria-label="Role test logins" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h2>Role test logins</h2><span className="subtle" style={{ fontSize: 12 }}>Demo workspace only · fictional accounts · shown once</span></div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        <p className="muted">Sign in as each role (in a private window) to check exactly what a producer, crew member, cast member or external reviewer can see. Generating new logins replaces the previous password and signs those accounts out.</p>
        <div><button className="btn btn-primary" disabled={pending} onClick={async () => { if (!res || confirm("Generate a new password? The previous one stops working.")) { const r = await run(resetDemoLoginsAction(), "New role logins generated"); if (r) setRes(r); } }}>{res ? "Generate new password" : "Generate role logins"}</button></div>
        {res && <>
          <div className="notice warn">Password for all accounts below (copy it now — it isn’t stored anywhere readable): <code className="mono" style={{ userSelect: "all", fontWeight: 700 }}>{res.password}</code></div>
          <div className="table-wrap" style={{ maxHeight: "none" }}><table className="data"><thead><tr><th>Role</th><th>Email</th><th>Name</th></tr></thead>
            <tbody>{res.accounts.map((a) => <tr key={a.email}><td>{ROLE_LABELS[a.role as Role] ?? a.role}</td><td className="mono" style={{ userSelect: "all" }}>{a.email}</td><td>{a.name}</td></tr>)}</tbody></table></div>
        </>}
      </div>
    </section>
  );
}
