import { InviteForm } from "./form";
export const metadata = { title: "Accept invitation" };
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="auth"><div className="auth-card">
      <h1 style={{ marginBottom: 4 }}>Join Bang On OS</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Set your name and a password (10+ characters).</p>
      <InviteForm token={token} />
    </div></main>
  );
}
