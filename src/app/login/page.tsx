import { redirect } from "next/navigation";
import { getContext } from "@/server/auth/request";
import { LoginForm } from "./form";
import { needsSetup } from "@/server/services/admin";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso_error?: string }> }) {
  if (await getContext()) redirect("/");
  if (await needsSetup()) redirect("/setup");
  const { next, sso_error } = await searchParams;
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: "0 0 20px" }}><span className="brand-mark">B</span><div>Bang On OS<small>Business &amp; production systems</small></div></div>
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Use the account your workspace administrator set up for you.</p>
        {sso_error && <div className="notice warn" role="alert" style={{ marginBottom: 14 }}>{sso_error}</div>}
        <LoginForm next={next ?? "/"} />
        <form action="/api/auth/sso/start" method="get" className="row" style={{ gap: 8, marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--line, #e5e5e5)" }}>
          <input name="org" aria-label="Workspace ID for single sign-on" placeholder="Workspace ID" required style={{ flex: 1, minWidth: 0 }} className="input" />
          <button className="btn">Sign in with SSO</button>
        </form>
      </div>
    </main>
  );
}
