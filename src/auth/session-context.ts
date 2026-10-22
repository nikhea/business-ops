/**
 * Mastra server middleware: attaches the authenticated principal and the
 * tenant's provider credentials to the per-request context.
 *
 * Registered through `server.middleware` so it runs after Mastra creates the
 * RequestContext and before any route handler.
 */

import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { createMiddleware } from "hono/factory";
import type { HonoVariables } from "@mastra/hono";
import { applyCredentialContext } from "./credentials";
import { resolvePrincipal } from "./principal";

export const sessionContext = createMiddleware<{ Variables: HonoVariables }>(async (c, next) => {
  const requestContext = c.get("requestContext");

  if (requestContext) {
    const principal = await resolvePrincipal(c.req.raw);

    if (principal) {
      requestContext.set("user", principal);
      requestContext.set(MASTRA_RESOURCE_ID_KEY, `user:${principal.id}`);

      try {
        await applyCredentialContext(requestContext, principal.id);
      } catch (error) {
        console.error(
          "[auth] Could not load provider credentials for the request context:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  await next();
});
