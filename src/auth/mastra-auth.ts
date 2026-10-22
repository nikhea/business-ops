/**
 * Mastra auth provider.
 *
 * Mastra hands us the bearer token (empty for cookie-only requests) plus the
 * raw request. We resolve a principal from either the session cookie or an API
 * key, and map it to a Mastra resource id so memory/thread ownership is scoped
 * to the authenticated user instead of a client-supplied value.
 */

import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import type { Principal } from "./index";
import { resolvePrincipal } from "./principal";

interface AuthRequestLike {
  raw?: Request;
  headers?: Headers | Record<string, string | string[] | undefined>;
  header?(name: string): string | undefined;
}

function toRequest(request: AuthRequestLike | Request | undefined): Request | null {
  if (request instanceof Request) return request;
  if (!request) return null;
  if (request.raw instanceof Request) return request.raw;
  if (!request.headers) return null;

  const headers = new Headers();
  if (request.headers instanceof Headers) {
    request.headers.forEach((value, key) => headers.set(key, value));
  } else {
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
  }

  return new Request("http://localhost/", { headers });
}

export const mastraAuth = {
  name: "better-auth",

  async authenticateToken(
    _token: string,
    request: AuthRequestLike | Request,
  ): Promise<Principal | null> {
    const httpRequest = toRequest(request);
    if (!httpRequest) return null;
    return resolvePrincipal(httpRequest);
  },

  authorizeUser(): boolean {
    // Any authenticated user may call the API. Tool-level role checks live in
    // the route guards for now.
    return true;
  },

  mapUserToResourceId(user: Principal): string {
    return `user:${user.id}`;
  },
};

export { MASTRA_RESOURCE_ID_KEY };
