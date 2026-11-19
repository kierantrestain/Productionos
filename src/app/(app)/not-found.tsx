import Link from "next/link";
export default function NotFound() {
  return <div className="panel"><div className="empty"><h3>Not found</h3><p className="muted">This record doesn&apos;t exist or you don&apos;t have access to it.</p><Link className="btn" style={{ marginTop: 12 }} href="/">Back to Command Centre</Link></div></div>;
}
