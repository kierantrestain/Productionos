import { redirect } from "next/navigation";
import { needsSetup } from "@/server/services/admin";
import { SetupForm } from "./form";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Set up Production OS" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <main className="auth">
      <div className="auth-card" style={{ width: "min(460px, 100%)" }}>
        <div className="brand" style={{ padding: "0 0 20px" }}><span className="brand-mark">B</span><div>Production OS<small>First-run setup</small></div></div>
        <h1 style={{ marginBottom: 4 }}>Create your workspace</h1>
        <p className="muted" style={{ marginBottom: 20 }}>This creates your organisation and its first administrator. It only works once — afterwards, invite your team from Admin.</p>
        <SetupForm />
      </div>
    </main>
  );
}
