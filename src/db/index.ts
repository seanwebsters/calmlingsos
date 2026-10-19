/**
 * Database access. PostgreSQL (DATABASE_URL=postgres://…) in production;
 * the embedded PGlite engine (real Postgres compiled to WASM, persisted to
 * DATA_DIR) when no server is configured. Both run the same migrations.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };

interface DbState {
  promise: Promise<DB> | null;
  close: (() => Promise<void>) | null;
  url: string | null;
}
const g = globalThis as unknown as { __calmlingsDb?: DbState };
const state: DbState = (g.__calmlingsDb ??= { promise: null, close: null, url: null });

const migrationsFolder = () => path.join(process.cwd(), "drizzle");

async function connect(url: string | undefined): Promise<DB> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    state.close = () => pool.end();
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let dir = url?.startsWith("pglite:") ? url.slice("pglite:".length) : path.join(env.dataDir, "pglite");
  if (dir !== "memory://") {
    dir = path.resolve(dir);
    fs.mkdirSync(dir, { recursive: true });
  }
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  state.close = () => client.close();
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  const url = env.databaseUrl;
  if (!state.promise || state.url !== (url ?? null)) {
    state.url = url ?? null;
    state.promise = connect(url).catch((err) => {
      state.promise = null;
      throw err;
    });
  }
  return state.promise;
}

/** Test helper: close and forget the current connection. */
export async function resetDb(): Promise<void> {
  if (state.promise) await state.promise.catch(() => null);
  await state.close?.();
  state.promise = null;
  state.close = null;
  state.url = null;
}
