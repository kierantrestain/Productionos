import { requirePageContext } from "@/server/auth/request";
import { TEMPLATES } from "@/server/platform/templates";
import { TemplateGrid } from "@/components/platform/home";

export const metadata = { title: "Templates" };
export default async function TemplatesPage() {
  const ctx = await requirePageContext();
  const cats = [...new Set(TEMPLATES.map((t) => t.category))];
  return (
    <div style={{ padding: "28px 32px", maxWidth: 1280 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>Templates</h1>
      <p style={{ color: "var(--color-text-secondary)", margin: "4px 0 20px" }}>Complete, linked systems — tables, relationships, rollups, formulas and views — with clearly-labelled example rows you can delete. {["owner", "creator"].includes(ctx.platformRole) ? "Pick one to create a base." : "Ask an owner or creator to create bases."}</p>
      {cats.map((c) => (
        <section key={c} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{c}</h2>
          <TemplateGrid templates={TEMPLATES.filter((t) => t.category === c)} />
        </section>
      ))}
    </div>
  );
}
