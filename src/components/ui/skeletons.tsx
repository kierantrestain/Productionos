/** Instant placeholders shown while a route's server data loads, so every click responds immediately. */
const S = ({ w, h = 14, r = 6 }: { w: number | string; h?: number; r?: number }) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} />;

export function BaseSkeleton() {
  return (
    <div className="p-base" aria-busy="true" aria-label="Loading">
      <div className="p-head" style={{ background: "var(--color-background-muted, rgba(127,127,127,.15))" }}><S w={28} h={28} r={8} /><S w={160} h={18} /><S w={360} h={16} /></div>
      <div className="p-body">
        <aside className="p-views" style={{ padding: 12, display: "grid", gap: 10, alignContent: "start" }}>{Array.from({ length: 6 }).map((_, i) => <S key={i} w={`${85 - (i % 3) * 15}%`} />)}</aside>
        <main className="p-main" style={{ padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <S w="40%" h={22} />{Array.from({ length: 10 }).map((_, i) => <S key={i} w="100%" h={28} />)}
        </main>
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ padding: 28, display: "grid", gap: 14, maxWidth: 1100, margin: "0 auto" }}>
      <S w={260} h={26} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>{Array.from({ length: 4 }).map((_, i) => <S key={i} w="100%" h={96} r={12} />)}</div>
      <S w="100%" h={260} r={12} />
    </div>
  );
}
