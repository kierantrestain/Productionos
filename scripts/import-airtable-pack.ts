/**
 * Airtable EXPORT PACK → Bang On OS native bases. Reads a read-only pack directory; never contacts Airtable.
 *
 *   pnpm import:airtable-pack --dir <pack> --org <slug>                       # dry run (no writes)
 *   pnpm import:airtable-pack --dir <pack> --org <slug> --apply               # create/update native bases
 *   pnpm import:airtable-pack --dir <pack> --org <slug> --apply --bases sinaport,appXXXX
 *   pnpm import:airtable-pack ... --create-org "Airtable import" --owner-email you@example.com   # local/staging only
 *
 * Reports (JSON + Markdown) go to ./private-import/ by default — gitignored, because they name
 * confidential tables and source IDs. Imported automations are always created disabled.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { memberships, organisations } from "@/db/schema";
import { contextForUser } from "@/server/auth/sessions";
import { createOrganisation, createUserWithMembership } from "@/server/services/admin";
import { importPack, loadPack, reportMarkdown } from "@/server/migration/airtable-pack";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const dir = arg("dir"), slug = arg("org");
  const apply = process.argv.includes("--apply");
  if (!dir || !slug) throw new Error("Usage: pnpm import:airtable-pack --dir <pack> --org <org-slug> [--apply] [--bases a,b] [--report <dir>]");
  if (!existsSync(dir)) throw new Error(`Pack directory not found: ${dir}`);
  const pack = loadPack(dir, arg("bases")?.split(",").map((s) => s.trim()).filter(Boolean));
  let [org] = await db.select().from(organisations).where(eq(organisations.slug, slug)).limit(1);
  if (!org && arg("create-org")) {
    const email = arg("owner-email");
    if (!email) throw new Error("--create-org needs --owner-email");
    org = await createOrganisation({ name: arg("create-org")!, slug, isDemo: false });
    // Random password is never printed: the owner signs in via password reset / invite flow.
    await createUserWithMembership({ orgId: org.id, email, name: "Import owner", password: randomBytes(24).toString("base64url"), role: "org_admin", platformRole: "owner" });
    console.log(`Created organisation "${org.name}" (${slug}) with owner ${email}`);
  }
  if (!org) throw new Error(`Organisation "${slug}" not found (use --create-org for a new local/staging org)`);
  const [owner] = await db.select().from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.platformRole, "owner"))).orderBy(asc(memberships.createdAt)).limit(1);
  if (!owner) throw new Error(`Organisation "${slug}" has no owner to act as`);
  const ctx = await contextForUser(owner.userId, org.id);
  if (!ctx) throw new Error("Couldn't resolve the owner's context");

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${pack.bases.length} base(s) from ${pack.dir} into "${org.name}"`);
  if (pack.issues.length) console.log(`Pack validation issues:\n${pack.issues.map((i) => `  - ${i}`).join("\n")}`);
  const report = await importPack({ ...ctx, platformRole: "owner" }, pack, { apply });

  const outDir = path.resolve(arg("report") ?? path.join("private-import", `airtable-${apply ? "apply" : "dryrun"}-${report.generatedAt.replace(/[:.]/g, "-")}`));
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(outDir, "reconciliation.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(path.join(outDir, "reconciliation.md"), reportMarkdown(report), { mode: 0o600 });
  console.table(report.totals);
  console.log(`Reports written to ${outDir}`);
}

main().then(() => closeDb()).catch(async (e) => { console.error(e instanceof Error ? (process.env.DEBUG ? e.stack : e.message) : e); await closeDb(); process.exit(1); });
