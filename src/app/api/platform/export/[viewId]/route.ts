import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/request";
import { toResult } from "@/server/errors";
import { viewContext } from "@/server/platform/schema";
import { runView } from "@/server/platform/query";
import { audit } from "@/server/audit";
import { db } from "@/db";
import { cellText } from "@/lib/platform/cell-text";

/** Export the rows of a view (filters, sorts and field visibility applied; role-hidden fields never included). */
export async function GET(req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { viewId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (!["csv", "json", "xml", "xlsx"].includes(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  const r = await toResult(async () => {
    const { view, access, table } = await viewContext(ctx, viewId);
    const out = await runView(ctx, access.role, view.tableId, view.config, { search: url.searchParams.get("q") ?? undefined });
    const hidden = new Set(view.config.hidden ?? []);
    const fields = out.fields.filter((f) => f.id === table.primaryFieldId || !hidden.has(f.id));
    await audit(db, ctx, "export", "base_views", viewId, { meta: { format, rows: out.rows.length, table: table.name } });
    return { name: `${table.name} - ${view.name}`, fields, rows: out.rows.map((row) => ({ id: row.id, cells: fields.map((f) => cellText(f, row.values[f.id])), raw: row.values })) };
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code === "forbidden" ? 403 : 404 });
  const { name, fields, rows } = r.data;
  const file = name.replace(/[^\w\- ]+/g, "").trim() || "export";
  const dl = (body: BodyInit, type: string, ext: string) => new NextResponse(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${file}.${ext}`)}`, "Cache-Control": "private, no-store" } });
  if (format === "csv") {
    // Neutralise spreadsheet formula injection (=, +, -, @ at cell start).
    const esc = (s: string) => { const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const csv = [fields.map((f) => esc(f.name)).join(","), ...rows.map((x) => x.cells.map(esc).join(","))].join("\r\n");
    return dl(`﻿${csv}`, "text/csv; charset=utf-8", "csv");
  }
  if (format === "json") {
    const json = rows.map((x) => ({ id: x.id, ...Object.fromEntries(fields.map((f, i) => [f.name, simple(x.raw[f.id], x.cells[i])])) }));
    return dl(JSON.stringify({ table: name, exportedAt: new Date().toISOString(), records: json }, null, 2), "application/json", "json");
  }
  if (format === "xml") {
    const x = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    const body = rows.map((row) => `  <record id="${row.id}">\n${fields.map((f, i) => `    <field name="${x(f.name)}" type="${f.type}">${x(row.cells[i])}</field>`).join("\n")}\n  </record>`).join("\n");
    return dl(`<?xml version="1.0" encoding="UTF-8"?>\n<records table="${x(name)}" exportedAt="${new Date().toISOString()}">\n${body}\n</records>\n`, "application/xml", "xml");
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); wb.creator = "Bang On OS";
  const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.columns = fields.map((f) => ({ header: f.name, key: f.id, width: Math.min(60, Math.max(12, f.name.length + 4)) }));
  for (const row of rows) ws.addRow(Object.fromEntries(fields.map((f, i) => {
    const v = row.raw[f.id];
    if (["number", "currency", "percent", "rating", "duration", "count", "autonumber"].includes(f.type) && typeof v === "number") return [f.id, v];
    if (f.type === "checkbox") return [f.id, !!v];
    if ((f.type === "date" || f.type === "dateTime") && v) return [f.id, new Date(String(v))];
    return [f.id, row.cells[i]];
  })));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return dl(new Uint8Array(buf as ArrayBuffer), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
}

function simple(v: unknown, text: string): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return text ? text.split(", ") : [];
  return text;
}
