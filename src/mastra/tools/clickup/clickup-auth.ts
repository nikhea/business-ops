/**
 * Shared ClickUp API helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`clickupAccessToken`).
 * 2. `CLICKUP_API_TOKEN` / `CLICKUP_PERSONAL_TOKEN` environment variables.
 *
 * ClickUp personal tokens are sent as-is in the `Authorization` header, without
 * a `Bearer` prefix.
 */

export class ClickUpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClickUpAuthError";
  }
}

export class ClickUpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly ecode?: string,
  ) {
    super(message);
    this.name = "ClickUpApiError";
  }
}

export interface ClickUpToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

export function resolveClickUpToken(context?: ClickUpToolContext): string {
  const override =
    context?.requestContext?.get?.("clickupAccessToken") ??
    context?.requestContext?.get?.("clickupToken");

  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const environmentToken =
    process.env.CLICKUP_API_TOKEN?.trim() || process.env.CLICKUP_PERSONAL_TOKEN?.trim();

  if (environmentToken) return environmentToken;

  throw new ClickUpAuthError(
    "No ClickUp token is configured. Set CLICKUP_API_TOKEN in the environment " +
      "(ClickUp Settings > Apps > Generate API token) or pass `clickupAccessToken` " +
      "in the Request Context.",
  );
}

export interface ClickUpRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  query?: Record<string, unknown>;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  authContext?: ClickUpToolContext;
}

function queryValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Performs an authenticated ClickUp request and throws on non-2xx responses. */
export async function clickupFetch(
  path: string,
  options: ClickUpRequestOptions = {},
): Promise<Response> {
  const { query, json, headers, authContext, ...init } = options;

  const target = new URL(
    path.startsWith("http")
      ? path
      : `${CLICKUP_BASE}${path.startsWith("/") ? "" : "/"}${path}`,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        target.searchParams.append(key, queryValue(item));
      }
    } else {
      target.searchParams.set(key, queryValue(value));
    }
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Authorization", resolveClickUpToken(authContext));

  let body = init.body;
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(target, { ...init, headers: requestHeaders, body });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "no details";
    let ecode: string | undefined;

    try {
      const parsed = JSON.parse(detail) as {
        err?: string;
        ECODE?: string;
        message?: string;
      };

      ecode = parsed.ECODE;
      message = parsed.err ?? parsed.message ?? detail;
      if (ecode) message = `${ecode}: ${message}`;
    } catch {
      // Response was not JSON; keep the raw text.
    }

    throw new ClickUpApiError(
      `ClickUp request failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      ecode,
    );
  }

  return response;
}

/** Performs an authenticated ClickUp request and parses the JSON output. */
export async function clickupRequest<T>(
  path: string,
  options: ClickUpRequestOptions = {},
): Promise<T> {
  const response = await clickupFetch(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;

  return JSON.parse(text) as T;
}
