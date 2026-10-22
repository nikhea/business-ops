/**
 * Hono guards for routes that live outside Mastra's own auth middleware.
 */

import type { MiddlewareHandler } from "hono";
import { isAdmin, resolvePrincipal, resolveSessionPrincipal } from "./principal";

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function signInRedirect(request: Request): string {
  const url = new URL(request.url);
  return `/signin?next=${encodeURIComponent(url.pathname + url.search)}`;
}

function unauthorized(request: Request): Response {
  if (wantsHtml(request)) {
    return new Response(null, { status: 302, headers: { Location: signInRedirect(request) } });
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const principal = await resolvePrincipal(c.req.raw);
  if (!principal) return unauthorized(c.req.raw);
  await next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const principal = await resolvePrincipal(c.req.raw);
  if (!principal) return unauthorized(c.req.raw);
  if (!isAdmin(principal)) {
    return Response.json({ error: "Forbidden", message: "Admin role required." }, { status: 403 });
  }
  await next();
};

/**
 * Admin routes call Better Auth's admin APIs, which read the session from the
 * request headers. API keys authenticate fine at the edge but cannot back those
 * calls, so require a real session instead of failing downstream with a 500.
 */
export const requireAdminSession: MiddlewareHandler = async (c, next) => {
  const principal = await resolveSessionPrincipal(c.req.raw);
  if (!principal) return unauthorized(c.req.raw);
  if (!isAdmin(principal)) {
    return Response.json({ error: "Forbidden", message: "Admin role required." }, { status: 403 });
  }
  await next();
};
