import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres>; __db?: DB };

function connect(): DB {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const client = postgres(url, {
    max: process.env.VERCEL ? 5 : 10,
    prepare: !/pooler|pgbouncer/.test(url),
    onnotice: () => {},
  });
  g.__pgClient = client;
  return drizzle(client, { schema });
}

/** Lazily-initialised singleton (survives Next.js dev hot reloads). */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    if (!g.__db) g.__db = connect();
    return Reflect.get(g.__db as object, prop);
  },
});

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;
export async function closeDb() {
  await g.__pgClient?.end({ timeout: 5 });
  g.__pgClient = undefined;
  g.__db = undefined;
}
export { schema };
