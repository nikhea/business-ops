/**
 * Shared user loading.
 *
 * Auth has three entry points (cookie session, API key, Studio JWT) but they all
 * end up as the same principal, so row mapping lives here instead of in each
 * resolver.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { user as userTable } from "../db/schema/auth";
import type { Principal } from "./index";

export function toPrincipal(row: {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  image?: string | null;
}): Principal {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role ?? "user",
    image: row.image ?? null,
  };
}

export async function loadUser(userId: string): Promise<Principal | null> {
  const rows = await getDb()
    .select()
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return rows[0] ? toPrincipal(rows[0]) : null;
}
