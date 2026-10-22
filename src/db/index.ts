/**
 * Postgres connection and Drizzle instance.
 *
 * The pool is created lazily so importing this module in a test or CLI context
 * does not open sockets.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl } from "../config/env";
import * as appSchema from "./schema/app";
import * as authSchema from "./schema/auth";

export const schema = { ...appSchema, ...authSchema };

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });

    pool.on("error", (error) => {
      console.error("[db] idle client error:", error.message);
    });
  }

  return pool;
}

export function createDb() {
  return drizzle(getPool(), { schema });
}

export type Database = ReturnType<typeof createDb>;

let database: Database | undefined;

export function getDb(): Database {
  if (!database) database = createDb();
  return database;
}

export async function closeDb(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  database = undefined;
  await current.end().catch(() => undefined);
}
