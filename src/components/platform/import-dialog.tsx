"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@/components/ui/modal";
import { importSpreadsheetAction } from "@/app/platform-actions";

/** Import CSV / Excel as a new base, or as a new table when baseId is given. */
export function ImportDialog({ isOpen, onClose, baseId }: { isOpen: boolean; onClose: () => void; baseId?: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  return (
    <Dialog isOpen={isOpen} onOpenChange={(o) => !o && onClose()} width={520} padding={6} purpose="form">
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{baseId ? "Import into a new table" : "Import a spreadsheet"}</h2>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: 16 }}>CSV or Excel (.xlsx, first sheet). The first row becomes field names; field types — numbers, currency, dates, checkboxes, emails, links and single selects — are detected automatically. You can change any of them afterwards.</p>
      <label className="p-basecard" style={{ cursor: "pointer", justifyContent: "center", padding: 24, borderStyle: "dashed" }}>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx" style={{ display: "none" }} aria-label="Choose file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(""); }} />
        <span>{file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "Choose a .csv or .xlsx file"}</span>
      </label>
      {err && <p style={{ color: "var(--color-text-error)", marginTop: 12 }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Button label="Cancel" onClick={onClose} />
        <Button label="Import" variant="primary" isDisabled={!file} clickAction={async () => {
          const fd = new FormData(); fd.set("file", file!); if (baseId) fd.set("baseId", baseId);
          const r = await importSpreadsheetAction(fd);
          if (!r.ok) { setErr(r.error); return; }
          onClose(); router.push(`/base/${r.data.baseId}/${r.data.tableId}`); router.refresh();
        }} />
      </div>
    </Dialog>
  );
}
