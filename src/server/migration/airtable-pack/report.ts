/** Human-readable reconciliation report (Markdown) from an ImportReport. Written only to private storage. */
import type { ImportReport } from "./importer";

export function reportMarkdown(r: ImportReport): string {
  const L: string[] = [];
  const t = r.totals;
  L.push(`# Airtable pack reconciliation — ${r.mode}`, "", `Generated ${r.generatedAt} · pack export ${r.pack.exportDateUTC ?? "?"} · target org ${r.orgId}`, "");
  L.push("## Totals", "", "| Measure | Value |", "|---|---:|");
  for (const [k, v] of Object.entries(t)) L.push(`| ${k} | ${v} |`);
  L.push("", r.pack.issues.length ? `### Pack validation issues (${r.pack.issues.length})\n${r.pack.issues.map((i) => `- ${i}`).join("\n")}` : "Pack validation: no issues (manifest counts, unique source IDs and references all check out).", "");
  for (const b of r.bases) {
    L.push(`## ${b.baseName} (${b.baseId}) → ${b.targetBaseId ?? "(not created — dry run)"}`, "");
    L.push("| Kind | Source | Created | Already imported |", "|---|---:|---:|---:|");
    for (const [k, c] of Object.entries(b.counts)) L.push(`| ${k} | ${c.source} | ${c.created} | ${c.existing} |`);
    L.push("", "### Records per table", "", "| Table | Source ID | Manifest | Export file | Created | Updated | Unchanged | In Bang On OS | Match |", "|---|---|---:|---:|---:|---:|---:|---:|---|");
    for (const tr of b.tables) {
      const ok = tr.afterImport === null ? "—" : tr.afterImport === tr.sourceRecords && (tr.manifestRecords === null || tr.manifestRecords === tr.sourceRecords) ? "✔" : "✘";
      L.push(`| ${tr.name} | ${tr.sourceTableId} | ${tr.manifestRecords ?? "?"} | ${tr.sourceRecords} | ${tr.created} | ${tr.updated} | ${tr.unchanged} | ${tr.afterImport ?? "—"} | ${ok} |`);
    }
    L.push("", "### Field type mapping", "", "| Airtable type | → Bang On OS type(s) |", "|---|---|");
    for (const [at, m] of Object.entries(b.fieldMapping)) L.push(`| ${at} | ${Object.entries(m).filter(([, n]) => n > 0).map(([k, n]) => `${k} × ${n}`).join(", ")} |`);
    L.push("", `### Links`, "", `${b.links.valuesInRecords} link values in records (pack edge manifest: ${b.links.edgesInManifest}); ${b.links.resolved} resolved, ${b.links.unresolved.length} unresolved.`);
    if (b.links.unresolved.length) L.push("", ...b.links.unresolved.slice(0, 200).map((u) => `- ${u.tableId}/${u.recordId} field ${u.fieldId} → missing ${u.targetRecordId}`));
    const ff = b.formulaFidelity;
    L.push("", "### Formula fidelity (recomputed vs exported values)", "", `${ff.fields} native formula fields, ${ff.compared} values compared: ${ff.matched} match, ${Object.values(ff.explained).reduce((n, x) => n + x, 0)} differ for an expected reason, ${ff.mismatched} unexplained.`);
    for (const [k, n] of Object.entries(ff.explained)) L.push(`- expected: ${k} — ${n}`);
    for (const m of ff.mismatchedFields) L.push(`- ${m.name} (${m.fieldId}): ${m.mismatches} differing value(s) — ${m.reason}${m.sample ? ` (e.g. ${m.sample.recordId}: exported “${m.sample.exported}”, recomputed “${m.sample.recomputed}”)` : ""}`);
    L.push("", `### Forms (${b.forms.length})`, "");
    for (const f of b.forms) L.push(`- ${f.name} (${f.sourceId}): ${f.status}; ${f.mappedElements}/${f.elements} elements${f.notes.length ? ` — ${f.notes.join("; ")}` : ""}`);
    L.push("", `### Interface pages (${b.pages.length})`, "", "| Page | Kind | Type | Status |", "|---|---|---|---|");
    for (const p of b.pages) L.push(`| ${p.name} (${p.sourceId}) | ${p.kind} | ${p.pageType ?? ""} | ${p.status} |`);
    L.push("", `### Automations (${b.automations.length}) — all imported ones are DISABLED`, "", "| Automation | Source status | Trigger | Created | Steps translated | Not translated |", "|---|---|---|---|---:|---|");
    for (const a of b.automations) L.push(`| ${a.name} (${a.sourceId}) | ${a.sourceStatus} | ${a.trigger} | ${a.created ? "yes (disabled)" : "no"} | ${a.translatedSteps} | ${a.untranslated.join("; ") || "—"} |`);
    L.push("", `### Attachments`, "", `${b.attachments.references} attachment references in the pack manifest; ${b.attachments.pendingTransfer} attachment entries imported as metadata marked **pending transfer** (file bytes are not in the export).`);
    const byCat = new Map<string, number>();
    for (const w of b.warnings) byCat.set(w.category, (byCat.get(w.category) ?? 0) + 1);
    L.push("", `### Warnings (${b.warnings.length})`, "", ...[...byCat].map(([k, n]) => `- ${k}: ${n}`), "", "<details><summary>All warnings</summary>", "", ...b.warnings.map((w) => `- [${w.category}] ${w.name} (${w.sourceId}): ${w.message}`), "", "</details>", "");
  }
  return L.join("\n");
}
