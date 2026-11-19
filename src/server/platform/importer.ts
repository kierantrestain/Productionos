/**
 * Spreadsheet import (CSV / Excel): parse, infer field types per column, build a base or a new table.
 */
import ExcelJS from "exceljs";
import type { FieldType } from "@/lib/platform/fields";
import { invalid } from "../errors";
import type { SpecField, SpecTable } from "./spec";

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). Auto-detects ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0]; if (!ws) throw invalid("The workbook has no sheets.");
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = r.getCell(c).value as unknown;
      vals.push(v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" && v && "text" in (v as object) ? String((v as { text: string }).text) : typeof v === "object" && v && "result" in (v as object) ? String((v as { result: unknown }).result ?? "") : String(v));
    }
    rows.push(vals);
  });
  return rows;
}

const isNum = (s: string) => /^-?[£$€]?\s?-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?[£$€]?\s?-?\d+(\.\d+)?$/.test(s.trim());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s);
const toIsoDate = (s: string) => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return s; const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };

export function inferTable(name: string, rows: string[][]): SpecTable {
  if (rows.length < 1) throw invalid("The file is empty.");
  if (rows.length > 20_001) throw invalid("Files are limited to 20,000 rows.");
  const header = rows[0].map((h, i) => h.trim() || `Field ${i + 1}`);
  const seen = new Map<string, number>();
  const names = header.map((h) => { const n = (seen.get(h.toLowerCase()) ?? 0) + 1; seen.set(h.toLowerCase(), n); return n > 1 ? `${h} ${n}` : h; }).slice(0, 200);
  const body = rows.slice(1);
  const fields: SpecField[] = names.map((n, ci) => {
    const vals = body.map((r) => (r[ci] ?? "").trim()).filter(Boolean);
    let type: FieldType = "singleLineText"; let choices: string[] | undefined;
    if (ci > 0 && vals.length) {
      if (vals.every((v) => /^(true|false|yes|no|y|n|✓|x|0|1)$/i.test(v)) && new Set(vals.map((v) => v.toLowerCase())).size <= 2 && vals.some((v) => /true|yes|✓|x|y/i.test(v))) type = "checkbox";
      else if (vals.every((v) => /%$/.test(v) && isNum(v.replace("%", "")))) type = "percent";
      else if (vals.every((v) => /^[£$€]/.test(v) && isNum(v))) type = "currency";
      else if (vals.every(isNum)) type = "number";
      else if (vals.every(isDate)) type = "date";
      else if (vals.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) type = "email";
      else if (vals.every((v) => /^https?:\/\//i.test(v))) type = "url";
      else if (vals.some((v) => v.length > 120 || v.includes("\n"))) type = "longText";
      else { const distinct = [...new Set(vals)]; if (distinct.length <= Math.max(2, Math.min(25, vals.length / 3)) && vals.length >= 4) { type = "singleSelect"; choices = distinct.slice(0, 50); } }
    }
    return { name: n, type, choices, options: type === "currency" ? { symbol: vals.find((v) => /^[£$€]/.test(v))?.[0] ?? "£", precision: 2 } : type === "number" ? { precision: vals.some((v) => v.includes(".")) ? 2 : 0 } : undefined };
  });
  const records = body.map((r) => Object.fromEntries(fields.map((f, ci) => {
    const raw = (r[ci] ?? "").trim();
    if (!raw) return [f.name, null];
    if (f.type === "checkbox") return [f.name, /true|yes|✓|x|^y$|^1$/i.test(raw)];
    if (f.type === "date") return [f.name, toIsoDate(raw)];
    if (f.type === "percent") return [f.name, raw];
    return [f.name, raw];
  })));
  return { name: name.slice(0, 120) || "Imported", fields, records };
}
