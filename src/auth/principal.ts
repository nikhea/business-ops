/**
 * Principal resolution: cookie session first, then API key.
 *
 * Results are cached per request (WeakMap) so the Hono guard, the Mastra auth
 * provider, and the request-context middleware share one lookup.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { user as userTable } from "../db/schema/auth";
import { auth, type Principal } from "./index";

const REQUEST_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  principal: Principal | null;
  expiresAt: number;
}

const sessionCache = new WeakMap<Request, Promise<Principal | null>>();
const apiKeyCache = new Map<string, CacheEntry>();

function toPrincipal(row: {
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

/** Reads a Bearer token or `?apiKey=` from the request. */
export function readApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }

  const fromQuery = new URL(request.url).searchParams.get("apiKey");
  return fromQuery?.trim() || null;
}

export async function resolveSessionPrincipal(request: Request): Promise<Principal | null> {
  const cached = sessionCache.get(request);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      return session ? toPrincipal(session.user) : null;
    } catch {
      // A malformed or expired cookie is not an error, just an anonymous request.
      return null;
    }
  })();

  sessionCache.set(request, pending);
  return pending;
}

async function loadUser(userId: string): Promise<Principal | null> {
  const rows = await getDb()
    .select()
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return rows[0] ? toPrincipal(rows[0]) : null;
}

export async function resolveApiKeyPrincipal(key: string): Promise<Principal | null> {
  const cached = apiKeyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.principal;

  let principal: Principal | null = null;
  try {
    const result = await auth.api.verifyApiKey({ body: { key } });
    const referenceId = result.valid ? result.key?.referenceId : undefined;
    if (referenceId) principal = await loadUser(referenceId);
  } catch {
    principal = null;
  }

  apiKeyCache.set(key, { principal, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
  return principal;
}

export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const session = await resolveSessionPrincipal(request);
  if (session) return session;

  const key = readApiKey(request);
  return key ? resolveApiKeyPrincipal(key) : null;
}

export function isAdmin(principal: Principal): boolean {
  const roles = principal.role.split(",").map((role) => role.trim());
  return roles.includes("admin");
}
