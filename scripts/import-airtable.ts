/**
 * Airtable → Production OS import CLI. Read-only against the export; defaults to a dry run.
 *   pnpm import:airtable --dir private_exports --org <org-slug>           # dry run (rolls back)
 *   pnpm import:airtable --dir private_exports --org <org-slug> --apply   # writes (staging first!)
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { organisations } from "@/db/schema";
import { runImport } from "@/server/import/runner";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dir = arg("dir"), slug = arg("org");
  const apply = process.argv.includes("--apply");
  if (!dir || !slug) throw new Error("Usage: pnpm import:airtable --dir <exportDir> --org <org-slug> [--apply]");
  const exportDir = path.resolve(dir);
  if (!existsSync(exportDir)) throw new Error(`Export directory not found: ${exportDir}`);
  const [org] = await db.select().from(organisations).where(eq(organisations.slug, slug)).limit(1);
  if (!org) throw new Error(`Organisation "${slug}" not found`);
  console.log(`${apply ? "APPLY" : "DRY RUN"} import of ${exportDir} into "${org.name}"`);
  const report = await runImport({ orgId: org.id, exportDir, mode: apply ? "apply" : "dry_run" });

  console.table(report.tables.filter((t) => t.sourceCount).map((t) => ({ table: `${t.base === "Ovation OS" ? "OVA" : "SAP"} ${t.table}`, target: t.target, source: t.sourceCount, imported: t.imported, updated: t.updated, unchanged: t.unchanged, archived: t.archived, exceptions: t.exceptions })));
  console.log("Totals:", report.totals);
  console.log("Editing ↔ Scenes reconciliation:", report.editingReconciliation);
  console.log("Attachments:", report.attachments);
  console.log("Exceptions by kind:", report.exceptionsByKind);
  console.log(`Inventory: ${report.inventory.exportedTables}/${report.inventory.expectedTables} tables; records ${report.inventory.actualRecordSum} vs dated ${report.inventory.expectedRecordSum}; ${report.inventory.recordDrift.length} tables drifted, ${report.inventory.missingTables.length} missing`);
  const outDir = path.resolve("private_exports");
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const out = path.join(outDir, `import-report-${report.batchId}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Report written to ${out} (PRIVATE — do not commit).`);
  if (!apply) console.log("Dry run only: nothing was written. Re-run with --apply against STAGING.");
}

main().then(() => closeDb()).catch(async (e) => { console.error(e.message ?? e); await closeDb(); process.exit(1); });
