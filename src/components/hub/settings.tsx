"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ConnectedApps } from "./connected-apps";
import { CheckCircle2, ChevronRight, CircleAlert, KeyRound, Keyboard, Monitor, Moon, Palette, Plug, ScrollText, ShieldCheck, Sun, UserRound, Users, Building2 } from "lucide-react";
import { changePasswordAction, updateProfileAction } from "@/app/hub-actions";
import { useThemeMode, type Mode } from "@/components/ui/theme-toggle";

type Status = { key: string; name: string; ok: boolean; detail: string }[];
const TABS = [
  { key: "profile", label: "Profile", icon: UserRound },
  { key: "security", label: "Password & sign-in", icon: KeyRound },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
  { key: "apps", label: "Connected apps", icon: Plug },
  { key: "workspace", label: "Workspace", icon: Building2 },
  { key: "integrations", label: "Integrations & status", icon: Plug, admin: true },
] as const;

export function SettingsView({ tab, user, org, admin, status, notice, error }: { notice?: string; error?: string; tab?: string; user: { name: string; email: string; role: string }; org: { name: string; isDemo: boolean }; admin: boolean; status: Status | null }) {
  const tabs = TABS.filter((t) => !("admin" in t) || admin);
  const active = tabs.find((t) => t.key === tab)?.key ?? "profile";
  return (
    <>
          {active === "profile" && <Profile user={user} />}
          {active === "security" && <Password />}
          {active === "appearance" && <Appearance />}
          {active === "shortcuts" && <Shortcuts />}
          {active === "apps" && <ConnectedApps notice={notice} error={error} />}
          {active === "workspace" && <Workspace org={org} admin={admin} role={user.role} />}
          {active === "integrations" && status && <Integrations status={status} />}
    </>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return <section className="st-card" aria-label={title}><h2>{title}</h2>{desc && <p className="st-desc">{desc}</p>}{children}</section>;
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) { return m ? <p role={m.ok ? "status" : "alert"} className={m.ok ? "st-ok" : "st-err"}>{m.text}</p> : null; }

function Profile({ user }: { user: { name: string; email: string; role: string } }) {
  const router = useRouter();
  const [name, setName] = useState(user.name); const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card title="Profile" desc="How you appear to your team in records, comments and the activity feed.">
      <form className="st-form" onSubmit={async (e) => { e.preventDefault(); const r = await updateProfileAction(name); setM(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); if (r.ok) router.refresh(); }}>
        <label>Name<input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
        <label>Email<input className="ui-input" value={user.email} disabled /></label>
        <label>Workspace role<input className="ui-input" value={user.role} disabled /></label>
        <div><Button type="submit" variant="primary" label="Save profile" isDisabled={!name.trim() || name === user.name} /></div>
        <Msg m={m} />
      </form>
    </Card>
  );
}

function Password() {
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const mismatch = !!again && next !== again;
  return (
    <Card title="Change password" desc="Changing your password signs you out on every other device.">
      <form className="st-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await changePasswordAction(cur, next); setBusy(false); setM(r.ok ? { ok: true, text: "Password changed. Other devices have been signed out." } : { ok: false, text: r.error }); if (r.ok) { setCur(""); setNext(""); setAgain(""); } }}>
        <label>Current password<input className="ui-input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
        <label>New password<input className="ui-input" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required /><small>At least 12 characters.</small></label>
        <label>Confirm new password<input className="ui-input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required aria-invalid={mismatch} />{mismatch && <small className="st-err">Passwords don&apos;t match.</small>}</label>
        <div><Button type="submit" variant="primary" label={busy ? "Changing…" : "Change password"} isDisabled={busy || !cur || next.length < 12 || next !== again} /></div>
        <Msg m={m} />
      </form>
    </Card>
  );
}

function Appearance() {
  const { mode, setMode } = useThemeMode();
  const opts: [Mode, string, React.ReactNode][] = [["light", "Light", <Sun key="l" size={18} />], ["dark", "Dark", <Moon key="d" size={18} />], ["system", "Match my device", <Monitor key="s" size={18} />]];
  return (
    <Card title="Theme" desc="Applies to the whole OS on this browser, including apps and the builder.">
      <div className="st-theme" role="radiogroup" aria-label="Theme">
        {opts.map(([k, l, i]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}><span className={`st-swatch ${k}`} aria-hidden />{i}{l}</button>)}
      </div>
    </Card>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [["⌘ K / Ctrl K", "Search bases, tables, apps and records, or run a command"], ["↑ ↓ then ↵", "Move through results and open one"], ["Esc", "Close any dialog or the search"], ["Enter (in a grid cell)", "Edit the cell; Enter again saves"], ["Tab / Shift Tab", "Move between cells and form fields"]];
  return <Card title="Keyboard shortcuts"><table className="st-keys"><tbody>{rows.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table></Card>;
}

function Workspace({ org, admin, role }: { org: { name: string; isDemo: boolean }; admin: boolean; role: string }) {
  const links: [string, string, string, React.ReactNode, boolean][] = [
    ["/workspace/members", "Members & roles", "Invite people, set workspace roles and free seats.", <Users key="m" size={18} />, true],
    ["/workspace/security", "Security & single sign-on", "SSO, sign-in policy.", <ShieldCheck key="s" size={18} />, admin],
    ["/workspace/api", "API & access tokens", "Scoped tokens for integrations and scripts.", <KeyRound key="a" size={18} />, true],
    ["/workspace/audit", "Audit log", "Every sensitive change, who made it and when.", <ScrollText key="l" size={18} />, admin],
  ];
  return (
    <Card title={org.name} desc={`${org.isDemo ? "Demo workspace · " : ""}You are ${role === "owner" ? "an owner" : `a ${role}`} here.`}>
      <ul className="st-links">{links.filter((l) => l[4]).map(([href, t, d, i]) => <li key={href}><Link href={href}>{i}<span><strong>{t}</strong><small>{d}</small></span><ChevronRight size={16} /></Link></li>)}</ul>
    </Card>
  );
}

function Integrations({ status }: { status: Status }) {
  return (
    <Card title="Integrations & system status" desc="Checked on the server just now. Anything marked “Not configured” is switched off, not pretending to work.">
      <ul className="st-status">{status.map((s) => <li key={s.key}>{s.ok ? <CheckCircle2 size={18} className="ok" /> : <CircleAlert size={18} className="no" />}<span><strong>{s.name}</strong><small>{s.detail}</small></span><em className={s.ok ? "ok" : "no"}>{s.ok ? "Ready" : "Not configured"}</em></li>)}</ul>
    </Card>
  );
}
