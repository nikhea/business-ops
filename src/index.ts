import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { auth } from "./auth";
import { requireAdmin, requireAdminSession, requireAuth } from "./auth/guards";
import { betterAuthUrl, validateEnv } from "./config/env";
import { mastra } from "./mastra/index";
import { adminRoutes } from "./routes/admin";
import { googleOAuthRoutes } from "./routes/google";
import { pageRoutes } from "./routes/pages";

// Fail fast on broken configuration instead of serving broken links.
validateEnv();

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

// Optional: only needed when a browser frontend lives on another origin.
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(
    "/auth/*",
    cors({
      origin: corsOrigins,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );
}

/**
 * Better Auth owns /auth/*.
 *
 * It must not be /api/auth/*: Mastra already registers its own endpoints there
 * (capabilities, me, logout, refresh, sso). Keeping them apart avoids shadowing.
 */
app.all("/auth/*", (c) => auth.handler(c.req.raw));

// Guards are registered before the routes they protect: Hono runs matching
// handlers in registration order.
app.use("/api", requireAuth);
app.use("/api/*", requireAuth);
app.use("/admin", requireAdminSession);
app.use("/admin/*", requireAdminSession);

// Connecting a company-wide Google Workspace account is an admin action.
app.use("/google", requireAuth);
app.use("/google/*", requireAuth);
app.use("/google/*", requireAdmin);

app.use("/swagger-ui", requireAuth);
app.use("/swagger-ui/*", requireAuth);

app.route("/admin", adminRoutes);
app.route("/", pageRoutes);

const server = new MastraServer({ app, mastra, openapiPath: "/openapi.json" });
await server.init();

app.route("/google", googleOAuthRoutes);

app.get("/", (c) => {
  return c.json({
    name: "Business Ops",
    status: "ok",
    auth: "/auth/ok",
    signIn: "/signin",
    openapi: "/api/openapi.json",
  });
});

app.get("/me", async (c) => {
  const { resolvePrincipal } = await import("./auth/principal");
  const principal = await resolvePrincipal(c.req.raw);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user: principal });
});

// MastraServer serves the spec at <prefix><openapiPath>, and prefix defaults to /api
const openapiUrl = "/api/openapi.json";

app.use("/swagger-ui/*", swaggerUI({ url: openapiUrl }));

const port = Number(process.env.PORT || 5000);

const configured = new URL(betterAuthUrl());
if (Number(configured.port || (configured.protocol === "https:" ? 443 : 80)) !== port) {
  console.warn(
    `[config] PORT (${port}) does not match BETTER_AUTH_URL (${configured.origin}). ` +
      "Invite links and cookie origins will point at the wrong port.",
  );
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Sign in:      http://localhost:${port}/signin`);
  console.log(`Auth:         http://localhost:${port}/auth/ok`);
  console.log(`OpenAPI spec: http://localhost:${port}${openapiUrl}`);
  console.log(`Swagger UI:   http://localhost:${port}/swagger-ui`);
});
