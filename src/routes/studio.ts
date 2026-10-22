/**
 * Mastra Studio, served by this app at /studio.
 *
 * Studio is a static SPA. It is not part of @mastra/hono, so we serve the
 * prebuilt assets that ship with the `mastra` package and point them back at
 * this server (http://localhost:5000) instead of the default 4111.
 *
 * Studio auth is JWT-only (see src/auth/studio.ts). The index route mints a
 * short-lived token from the visitor's Better Auth session and hands it to the
 * SPA through `?auth_header=Bearer ...`; Studio keeps it in memory and sends it
 * as the Authorization header on every API call.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono } from "hono";
import { betterAuthUrl, readEnv } from "../config/env";
import { resolveSessionPrincipal } from "../auth/principal";
import { mintStudioToken } from "../auth/studio";

const BASE_PATH = "/studio";
const DEFAULT_ASSETS = "node_modules/mastra/dist/studio";

function findStudioAssets(): string | null {
  const bundled = (() => {
    try {
      return join(dirname(fileURLToPath(import.meta.resolve("mastra"))), "studio");
    } catch {
      return null;
    }
  })();

  const candidates = [
    readEnv("MASTRA_STUDIO_PATH"),
    DEFAULT_ASSETS,
    bundled,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (existsSync(join(absolute, "index.html"))) return absolute;
  }

  return null;
}

function jsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");
}

function renderIndex(assetsDir: string): string {
  const origin = new URL(betterAuthUrl());
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  const protocol = origin.protocol.replace(":", "");

  const values: Record<string, string> = {
    MASTRA_AGENT_SIGNALS: "true",
    MASTRA_API_PREFIX: "/api",
    MASTRA_AUTO_DETECT_URL: "false",
    MASTRA_CLOUD_API_ENDPOINT: "",
    MASTRA_DEV_SERVER_INSTANCE_ID: "",
    MASTRA_EXPERIMENTAL_FEATURES: "false",
    MASTRA_EXPERIMENTAL_UI: "false",
    MASTRA_HIDE_CLOUD_CTA: "true",
    MASTRA_ORGANIZATION_ID: "",
    MASTRA_PLATFORM_OBSERVABILITY_ENDPOINT: "",
    MASTRA_PLATFORM_PROJECT_ID: "",
    MASTRA_REQUEST_CONTEXT_PRESETS: "",
    MASTRA_SERVER_HOST: origin.hostname,
    MASTRA_SERVER_PORT: port,
    MASTRA_SERVER_PROTOCOL: protocol,
    MASTRA_SIGNALS_UI: "false",
    MASTRA_STUDIO_BASE_PATH: BASE_PATH,
    MASTRA_TELEMETRY_DISABLED: "true",
    MASTRA_TEMPLATES: "false",
  };

  let html = readFileSync(join(assetsDir, "index.html"), "utf8");
  for (const [key, value] of Object.entries(values)) {
    html = html.replaceAll(`%%${key}%%`, jsString(value));
  }
  return html;
}

export function registerStudioRoutes(app: Hono<any>): void {
  const assetsDir = findStudioAssets();
  const indexHtml = assetsDir ? renderIndex(assetsDir) : null;

  const serveIndex = async (c: Context) => {
    if (!indexHtml) {
      return c.text(
        "Mastra Studio assets were not found. Install the `mastra` package or set MASTRA_STUDIO_PATH.",
        503,
      );
    }

    // Studio itself is only reachable with a browser session.
    const session = await resolveSessionPrincipal(c.req.raw);
    if (!session) {
      return c.redirect(`/signin?next=${encodeURIComponent(BASE_PATH)}`);
    }

    // Hand the SPA a fresh JWT. It reads auth_header once, keeps it in memory,
    // and strips it from the address bar.
    if (!c.req.query("auth_header")) {
      const token = mintStudioToken(session);
      return c.redirect(`${BASE_PATH}/?auth_header=${encodeURIComponent(`Bearer ${token}`)}`);
    }

    return c.html(indexHtml, 200, { "Cache-Control": "no-store" });
  };

  app.get(BASE_PATH, serveIndex);
  app.get(`${BASE_PATH}/`, serveIndex);
  app.get(`${BASE_PATH}/index.html`, serveIndex);

  // The Studio HTML always opens an EventSource here (mastra dev uses it for
  // live reload). Standalone Studio has nothing to push, and a 204 tells
  // EventSource to stop reconnecting instead of hammering the server.
  app.get(`${BASE_PATH}/refresh-events`, (c) => c.body(null, 204));

  if (assetsDir) {
    app.use(
      `${BASE_PATH}/*`,
      serveStatic({
        root: assetsDir,
        rewriteRequestPath: (path) => path.replace(new RegExp(`^${BASE_PATH}`), ""),
      }),
    );
  }

  // Client-side routes under /studio fall back to the SPA.
  app.get(`${BASE_PATH}/*`, serveIndex);
}
