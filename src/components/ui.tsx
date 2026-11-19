import Link from "next/link";
import type { ReactNode } from "react";
import { humanize, tone } from "@/lib/format";
import { Icon } from "./icons";

export function Badge({ value, label, className = "" }: { value?: string | null; label?: string; className?: string }) {
  if (!value && !label) return <span className="subtle">—</span>;
  return <span className={`badge ${tone(value)} ${className}`}>{label ?? humanize(value)}</span>;
}

export function PageHeader({ title, eyebrow, lede, actions }: { title: ReactNode; eyebrow?: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Tabs({ tabs, active, base, extraParams }: { tabs: { key: string; label: string; count?: number }[]; active: string; base: string; extraParams?: Record<string, string> }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t) => {
        const qs = new URLSearchParams({ ...(extraParams ?? {}), tab: t.key }).toString();
        return (
          <Link key={t.key} href={`${base}?${qs}`} aria-current={active === t.key ? "page" : undefined}>
            {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Panel({ title, actions, children, flush, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; id?: string }) {
  return (
    <section className="panel" id={id} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && <div className="panel-head"><h2>{title}</h2>{actions && <div className="actions">{actions}</div>}</div>}
      <div className={`panel-body ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted" style={{ maxWidth: 520, margin: "0 auto" }}>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Notice({ tone: t = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={`notice ${t}`} role={t === "bad" ? "alert" : "status"}><Icon name={t === "ok" ? "check" : "alert"} />{<div>{children}</div>}</div>;
}

export function Forbidden({ what = "this area" }: { what?: string }) {
  return <Empty title="Not available for your role">You don&apos;t have access to {what}. Ask an organisation admin if you need it.</Empty>;
}
