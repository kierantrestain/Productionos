import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Migrate a dedicated test database (never the dev or production DB). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/productionos_test";
  if (!/test/.test(url)) throw new Error("Refusing to run tests against a non-test database URL");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
}
