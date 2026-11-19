"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /not found/i.test(error.message);
  const forbidden = /permission/i.test(error.message);
  return (
    <div className="panel"><div className="empty">
      <h3>{notFound ? "Not found" : forbidden ? "Not available for your role" : "Something went wrong"}</h3>
      <p className="muted">{notFound ? "This record doesn't exist or you don't have access to it." : forbidden ? "Ask an organisation admin if you need access." : "The page couldn't load. Nothing was changed."}</p>
      <button className="btn" style={{ marginTop: 12 }} onClick={reset}>Try again</button>
    </div></div>
  );
}
