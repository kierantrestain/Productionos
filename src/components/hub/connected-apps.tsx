"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckCircle2, CircleAlert, Download, ExternalLink, Link2, Plug, Search, Sparkles, Unplug } from "lucide-react";
import { Dialog } from "@/components/ui/modal";
import { confirmDialog } from "@/components/ui/dialogs";
import { appToolsAction, connectAppAction, connectionsOverviewAction, disconnectAppAction, disconnectChatgptAction, importAppDataAction, previewAppDataAction } from "@/app/connect-actions";
import type { AppInfo, AppTool, Connection } from "@/server/integrations/composio";

type Overview = { apps: AppInfo[]; live: boolean; configured: boolean; connections: Connection[]; chatgpt: { configuredReason: string | null; connected: boolean; account: string | null; since: string | null } };
const HUES = [210, 262, 330, 14, 32, 150, 190, 280];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

// Second logo source: the open-source Simple Icons set, version-pinned on a public CDN.
const SI: Record<string, string> = { gmail: "gmail", googlecalendar: "googlecalendar", googlesheets: "googlesheets", googledrive: "googledrive", slack: "slack", notion: "notion", hubspot: "hubspot", salesforce: "salesforce", github: "github", linear: "linear", jira: "jira", asana: "asana", trello: "trello", airtable: "airtable", outlook: "microsoftoutlook", microsoft_teams: "microsoftteams", dropbox: "dropbox", shopify: "shopify", stripe: "stripe", xero: "xero", quickbooks: "quickbooks", calendly: "calendly", zoom: "zoom", typeform: "typeform", mailchimp: "mailchimp", intercom: "intercom", zendesk: "zendesk", clickup: "clickup", youtube: "youtube", instagram: "instagram", linkedin: "linkedin" };
/** App logo: Composio logo → Simple Icons → lettered tile. */
export function AppLogo({ app, size = 40 }: { app: { slug: string; name: string; logo: string | null }; size?: number }) {
  const sources = [app.logo, SI[app.slug] ? `https://cdn.jsdelivr.net/npm/simple-icons@9.21.0/icons/${SI[app.slug]}.svg` : null].filter(Boolean) as string[];
  const [i, setI] = useState(0);
  const h = hue(app.slug);
  return i < sources.length
    ? <span className="ca-logo" style={{ width: size, height: size }}><img src={sources[i]} alt="" width={size - 14} height={size - 14} loading="lazy" onError={() => setI((x) => x + 1)} /></span>
    : <span className="ca-logo ca-letter" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 70% 45%))` }} aria-hidden>{app.name.slice(0, 1).toUpperCase()}</span>;
}

export function ConnectedApps({ notice, error }: { notice?: string; error?: string }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [q, setQ] = useState(""); const [cat, setCat] = useState("All"); const [err, setErr] = useState(error ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [pull, setPull] = useState<AppInfo | null>(null);
  const load = async (search = "") => { const r = await connectionsOverviewAction(search); if (r.ok) setData(r.data); else setErr(r.error); };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!data?.live) return; const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectedSlugs = new Set((data?.connections ?? []).filter((c) => c.status === "ACTIVE").map((c) => c.toolkit));
  const cats = useMemo(() => ["All", "Connected", ...[...new Set((data?.apps ?? []).flatMap((a) => a.categories))].sort().slice(0, 14)], [data]);
  const apps = (data?.apps ?? []).filter((a) => (cat === "All" || (cat === "Connected" ? connectedSlugs.has(a.slug) : a.categories.includes(cat))) && (data?.live || !q || `${a.name} ${a.description} ${a.categories.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const connect = async (a: AppInfo) => { setBusy(a.slug); setErr(""); const r = await connectAppAction(a.slug); setBusy(null); if (!r.ok) { setErr(r.error); return; } window.location.href = r.data.url; };
  const disconnect = async (a: AppInfo) => {
    const c = data?.connections.find((x) => x.toolkit === a.slug); if (!c) return;
    if (!(await confirmDialog(`Disconnect ${a.name}?`, { message: "Agents and imports will stop using this account. Data already pulled in stays.", danger: true, confirmLabel: "Disconnect" }))) return;
    const r = await disconnectAppAction(c.id); if (!r.ok) setErr(r.error); else load(q);
  };
  const gpt = data?.chatgpt;
  return (
    <div className="ca">
      <section className="ca-hero">
        <div><span className="ca-badge"><Plug size={13} /> Connected apps</span><h2>Bring your tools into Bang On OS</h2>
          <p>Connect the apps you already use. Pull their data into tables, and let your AI agents read from them and — with your approval — act in them, using your own accounts.</p></div>
      </section>
      {notice && <p role="status" className="ca-ok"><CheckCircle2 size={16} /> {notice}</p>}
      {err && <p role="alert" className="ca-err"><CircleAlert size={16} /> {err}</p>}

      <section className="ca-gpt" aria-label="ChatGPT plan">
        <span className="ca-gpt-ic" aria-hidden><Sparkles size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>Use your ChatGPT plan</h3>
          <p>{gpt?.connected ? `Connected${gpt.account ? ` as ${gpt.account}` : ""}. Agents set to “ChatGPT plan” run on your plan, within the limit you set in ChatGPT → Settings → Usage → App limits.` : "Sign in with ChatGPT so agents you chat with can run on your own ChatGPT plan instead of the workspace's AI key. You control how much of your plan Bang On OS may use in ChatGPT's settings, and can disconnect at any time."}</p>
          {gpt?.configuredReason && !gpt.connected && <p className="ca-note">{gpt.configuredReason}</p>}
        </div>
        {gpt?.connected
          ? <Button label="Disconnect" icon={<Unplug size={15} />} onClick={async () => { if (await confirmDialog("Disconnect your ChatGPT plan?", { danger: true, confirmLabel: "Disconnect" })) { const r = await disconnectChatgptAction(); if (!r.ok) setErr(r.error); else load(q); } }} />
          : <a className={`ca-btn primary ${gpt?.configuredReason ? "disabled" : ""}`} aria-disabled={!!gpt?.configuredReason} href={gpt?.configuredReason ? undefined : "/api/connect/chatgpt/start"}>Continue with ChatGPT</a>}
      </section>

      {data && !data.configured && <p className="ca-note ca-banner"><CircleAlert size={15} /> App connections aren&apos;t switched on yet: an administrator must add a Composio API key (COMPOSIO_API_KEY). Until then you can browse popular apps below; connecting is disabled.</p>}

      <div className="ca-tools">
        <label className="ca-search"><Search size={16} aria-hidden /><input placeholder={data?.live ? "Search 500+ apps" : "Search apps"} aria-label="Search apps" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="ca-cats" role="tablist" aria-label="Categories">{cats.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}{c === "Connected" && connectedSlugs.size ? ` (${connectedSlugs.size})` : ""}</button>)}</div>
      </div>

      {!data ? <div className="ca-grid" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="ca-card skeleton" style={{ height: 150 }} />)}</div> : (
        <div className="ca-grid">
          {apps.map((a) => { const on = connectedSlugs.has(a.slug); return (
            <article key={a.slug} className={`ca-card ${on ? "on" : ""}`} aria-label={a.name}>
              <div className="ca-card-top"><AppLogo app={a} /><div style={{ minWidth: 0 }}><h4>{a.name}</h4><span className="ca-cat">{a.categories[0] ?? "App"}</span></div>{on && <span className="ca-pill"><CheckCircle2 size={12} />Connected</span>}</div>
              <p>{a.description || `Connect ${a.name} to use it from your agents and pull its data into tables.`}</p>
              <div className="ca-actions">
                {on ? <>
                  <button type="button" className="ca-btn" onClick={() => setPull(a)}><Download size={14} />Pull data in</button>
                  <button type="button" className="ca-btn ghost" onClick={() => disconnect(a)} aria-label={`Disconnect ${a.name}`}><Unplug size={14} /></button>
                </> : <button type="button" className="ca-btn primary" disabled={!data.configured || busy === a.slug} onClick={() => connect(a)}><Link2 size={14} />{busy === a.slug ? "Opening…" : "Connect"}</button>}
              </div>
            </article>
          ); })}
          {!apps.length && <p className="ca-note">No apps match. {data.live ? "Try another name." : "More apps appear once Composio is connected."}</p>}
        </div>
      )}
      <p className="ca-foot">Connections are personal: each person signs in with their own account, and nobody else can use it. Powered by Composio <a href="https://composio.dev" target="_blank" rel="noopener noreferrer">composio.dev <ExternalLink size={11} /></a></p>
      {pull && <PullDialog app={pull} onClose={() => setPull(null)} onDone={(baseId, tableId) => router.push(`/base/${baseId}/${tableId}`)} />}
    </div>
  );
}

function PullDialog({ app, onClose, onDone }: { app: AppInfo; onClose: () => void; onDone: (baseId: string, tableId: string) => void }) {
  const [tools, setTools] = useState<AppTool[] | null>(null); const [tool, setTool] = useState(""); const [args, setArgs] = useState("{}");
  const [preview, setPreview] = useState<{ count: number; cols: string[]; sample: Record<string, string>[] } | null>(null);
  const [name, setName] = useState(app.name); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { appToolsAction(app.slug).then((r) => { if (r.ok) { setTools(r.data); setTool(r.data[0]?.slug ?? ""); } else setErr(r.error); }); }, [app.slug]);
  const parsed = () => { try { return JSON.parse(args || "{}"); } catch { setErr("Options must be valid JSON, e.g. {\"max_results\": 50}"); return null; } };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={720} padding={6} purpose="form">
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}><AppLogo app={app} /><div><h2 style={{ margin: 0, fontSize: 18 }}>Pull data from {app.name}</h2><p className="ca-note" style={{ margin: 0 }}>Choose what to read. Only read actions are offered — nothing is sent or changed in {app.name}.</p></div></div>
        {!tools ? <p className="ca-note">Loading what {app.name} can share…</p> : <>
          <label className="if-lbl">What to pull<select className="ui-input" value={tool} onChange={(e) => { setTool(e.target.value); setPreview(null); }}>{tools.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
          {tools.find((t) => t.slug === tool)?.description && <p className="ca-note" style={{ margin: 0 }}>{tools.find((t) => t.slug === tool)!.description}</p>}
          <label className="if-lbl">Options (JSON, optional)<textarea className="ui-input" rows={2} value={args} onChange={(e) => setArgs(e.target.value)} style={{ fontFamily: "var(--font-family-mono, monospace)", fontSize: 13 }} /></label>
          <div><Button label={busy ? "Reading…" : "Preview"} isDisabled={!tool || busy} onClick={async () => { const a = parsed(); if (!a) return; setBusy(true); setErr(""); const r = await previewAppDataAction(tool, a); setBusy(false); if (!r.ok) setErr(r.error); else setPreview(r.data); }} /></div>
        </>}
        {preview && (preview.count ? <>
          <p className="ca-note" style={{ margin: 0 }}>{preview.count} row{preview.count === 1 ? "" : "s"} · {preview.cols.length} columns. First rows:</p>
          <div className="ca-preview"><table><thead><tr>{preview.cols.slice(0, 8).map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{preview.sample.slice(0, 6).map((r, i) => <tr key={i}>{preview.cols.slice(0, 8).map((c) => <td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>
          <label className="if-lbl">New table name<input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </> : <p className="ca-note">That returned no rows. Try different options.</p>)}
        {err && <p role="alert" className="ca-err" style={{ margin: 0 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" label={busy ? "Importing…" : "Import into a new base"} isDisabled={!preview?.count || busy || !name.trim()} onClick={async () => { const a = parsed(); if (!a) return; setBusy(true); const r = await importAppDataAction({ tool, args: a, tableName: name }); setBusy(false); if (!r.ok) setErr(r.error); else onDone(r.data.baseId, r.data.tableId); }} />
        </div>
      </div>
    </Dialog>
  );
}
