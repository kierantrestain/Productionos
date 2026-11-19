"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadDemoAction, switchOrgAction } from "@/app/actions";

/** Builds the flagged demo workspace as its own request, with visible progress and retry. */
export function DemoLoader({ auto }: { auto: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(auto ? "loading" : "idle");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const started = useRef(false);
  const run = async () => {
    setState("loading"); setErr(""); setSecs(0);
    const r = await loadDemoAction().catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    if (r.ok) {
      setOrgId(r.data.orgId); setState("ready");
      // Drop ?loadDemo=1 without navigating (a navigation would unmount this panel and hide the result).
      window.history.replaceState(null, "", window.location.pathname);
      router.refresh();
    } else { setErr(r.error); setState("error"); }
  };
  useEffect(() => { if (auto && !started.current) { started.current = true; run(); } }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state !== "loading") return; const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [state]);
  if (state === "idle") return <button className="btn" onClick={run}>Load demo workspace</button>;
  return (
    <div className={`notice ${state === "error" ? "bad" : state === "ready" ? "ok" : "info"}`} style={{ marginBottom: 16 }} role="status" aria-live="polite">
      <div style={{ flex: 1 }}>
        {state === "loading" && <>Preparing your demo workspace — sample productions, schedules, budgets and post… <strong>{secs}s</strong> (usually under 30 seconds). You can keep working.</>}
        {state === "ready" && <>Demo workspace ready. It’s a separate, clearly labelled organisation — your own workspace stays empty and clean.</>}
        {state === "error" && <>The demo workspace couldn’t be prepared: {err}</>}
      </div>
      {state === "ready" && orgId && <button className="btn btn-primary btn-sm" onClick={() => switchOrgAction(orgId)}>Open demo workspace</button>}
      {state === "error" && <button className="btn btn-sm" onClick={run}>Try again</button>}
    </div>
  );
}
