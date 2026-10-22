/**
 * Studio JWT auth.
 *
 * Studio and the API have separate auth providers:
 *   - API: `server.auth` (cookie session or API key)
 *   - Studio: `studio.auth` (short-lived JWT)
 *
 * Studio sends `x-mastra-client-type: studio` on every API request, so Mastra
 * routes those calls through `studio.auth`. A browser session cannot be used to
 * reach Studio-only routes, and an API key alone cannot open the Studio UI.
 *
 * Tokens are minted from a real Better Auth session at `/studio`, handed to the
 * SPA through the `auth_header` query parameter, and kept in memory by Studio.
 */

import { MastraJwtAuth } from "@mastra/auth";
import { sign, verify, type JwtPayload, type SignOptions } from "jsonwebtoken";
import { requireEnv } from "../config/env";
import type { Principal } from "./index";
import { loadUser } from "./users";

const TOKEN_TTL: SignOptions["expiresIn"] = "12h";
const ISSUER = "business-ops";
const AUDIENCE = "mastra-studio";

export function studioJwtSecret(): string {
  return requireEnv("MASTRA_JWT_SECRET");
}

let provider: MastraJwtAuth | undefined;

/** Mastra auth provider for the Studio domain (JWT only). */
export function getStudioAuth(): MastraJwtAuth {
  if (provider) return provider;

  provider = new MastraJwtAuth({
    name: "studio-jwt",
    secret: studioJwtSecret(),
  });

  return provider;
}

export function mintStudioToken(principal: Principal): string {
  return sign(
    {
      sub: principal.id,
      email: principal.email,
      name: principal.name,
      role: principal.role,
    },
    studioJwtSecret(),
    {
      expiresIn: TOKEN_TTL,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
  );
}

/**
 * Resolve a Studio JWT to a live user row.
 *
 * The token is only a proof of identity; role and email come from Postgres so a
 * role change takes effect without waiting for tokens to expire.
 */
export async function resolveStudioToken(token: string): Promise<Principal | null> {
  // API keys are not JWTs; skip the verify call for obvious non-tokens.
  if (token.split(".").length !== 3) return null;

  try {
    const payload = verify(token, studioJwtSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as JwtPayload;

    const id = typeof payload.sub === "string" ? payload.sub : null;
    return id ? loadUser(id) : null;
  } catch {
    return null;
  }
}
