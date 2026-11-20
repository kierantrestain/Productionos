// Applies drizzle/*.sql migrations (same bookkeeping table as drizzle-kit: drizzle.__drizzle_migrations).
// Plain JavaScript with only the `postgres` driver, so it runs inside the slim production image.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required."); process.exit(1); }
const dir = path.resolve(process.env.MIGRATIONS_DIR || "./drizzle");
const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8"));
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
  const [last] = await sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
  const lastAt = last ? Number(last.created_at) : 0;
  let applied = 0;
  for (const e of journal.entries.sort((a, b) => a.when - b.when)) {
    if (e.when <= lastAt) continue;
    const text = readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    await sql.begin(async (tx) => {
      for (const stmt of text.split("--> statement-breakpoint")) if (stmt.trim()) await tx.unsafe(stmt);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${e.when})`;
    });
    applied++; console.log(`applied ${e.tag}`);
  }
  console.log(applied ? `Migrations applied: ${applied}.` : "Database is up to date.");
} finally { await sql.end(); }
