export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 20 }} />
      <div className="panel"><div className="panel-body stack" style={{ gap: 12 }}>{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - (i % 3) * 15}%` }} />)}</div></div>
    </div>
  );
}
