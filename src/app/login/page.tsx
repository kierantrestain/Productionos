import { redirect } from "next/navigation";
import { getContext } from "@/server/auth/request";
import { LoginForm } from "./form";
import { needsSetup } from "@/server/services/admin";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getContext()) redirect("/");
  if (await needsSetup()) redirect("/setup");
  const { next } = await searchParams;
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: "0 0 20px" }}><span className="brand-mark">B</span><div>Production OS<small>Bang On</small></div></div>
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Use the account your production office set up for you.</p>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
