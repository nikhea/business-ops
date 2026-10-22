/**
 * Principal resolution: cookie session first, then a bearer token.
 *
 * Bearer tokens can be a Studio JWT or an API key; Studio is tried first and
 * API keys second. Results are cached per request (WeakMap) so the Hono guard,
 * the Mastra auth provider, and the request-context middleware share one lookup.
 */

import { auth, type Principal } from "./index";
import { resolveStudioToken } from "./studio";
import { loadUser, toPrincipal } from "./users";

const sessionCache = new WeakMap<Request, Promise<Principal | null>>();

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

export async function resolveApiKeyPrincipal(key: string): Promise<Principal | null> {
  // No caching: verifyApiKey also enforces enabled/revoked state and rate
  // limits, so a revoked key must stop working on the very next request.
  try {
    const result = await auth.api.verifyApiKey({ body: { key } });
    const referenceId = result.valid ? result.key?.referenceId : undefined;
    return referenceId ? loadUser(referenceId) : null;
  } catch {
    return null;
  }
}

export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  const session = await resolveSessionPrincipal(request);
  if (session) return session;

  const token = readApiKey(request);
  if (!token) return null;

  // A Studio JWT is also accepted on API routes, so the browser can call the
  // same endpoints with the header Studio already sends.
  const fromStudio = await resolveStudioToken(token);
  if (fromStudio) return fromStudio;

  return resolveApiKeyPrincipal(token);
}

export function isAdmin(principal: Principal): boolean {
  const roles = principal.role.split(",").map((role) => role.trim());
  return roles.includes("admin");
}
