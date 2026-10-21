/**
 * Shared Airtable API helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`airtableAccessToken`).
 * 2. `AIRTABLE_PAT` / `AIRTABLE_API_KEY` / `AIRTABLE_ACCESS_TOKEN` environment
 *    variables. Airtable personal access tokens start with `pat`.
 *
 * The token needs the scopes for the tools you call:
 * - `data.records:read` / `data.records:write`
 * - `schema.bases:read`
 * - `data.recordComments:read` / `data.recordComments:write`
 * - `webhook:manage`
 */

export class AirtableAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirtableAuthError";
  }
}

export class AirtableApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
    this.name = "AirtableApiError";
  }
}

export interface AirtableToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

const AIRTABLE_BASE = "https://api.airtable.com/v0";

export function resolveAirtableToken(context?: AirtableToolContext): string {
  const override =
    context?.requestContext?.get?.("airtableAccessToken") ??
    context?.requestContext?.get?.("airtableToken");

  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const environmentToken =
    process.env.AIRTABLE_PAT?.trim() ||
    process.env.AIRTABLE_API_KEY?.trim() ||
    process.env.AIRTABLE_ACCESS_TOKEN?.trim();

  if (environmentToken) return environmentToken;

  throw new AirtableAuthError(
    "No Airtable token is configured. Set AIRTABLE_PAT in the environment " +
      "(create one at https://airtable.com/create/tokens) or pass `airtableAccessToken` " +
      "in the Request Context.",
  );
}

export interface AirtableRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  query?: Record<string, unknown>;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  authContext?: AirtableToolContext;
}

function queryValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Performs an authenticated Airtable request and throws on non-2xx responses. */
export async function airtableFetch(
  path: string,
  options: AirtableRequestOptions = {},
): Promise<Response> {
  const { query, json, headers, authContext, ...init } = options;

  const target = new URL(
    path.startsWith("http")
      ? path
      : `${AIRTABLE_BASE}${path.startsWith("/") ? "" : "/"}${path}`,
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
  requestHeaders.set("Authorization", `Bearer ${resolveAirtableToken(authContext)}`);

  let body = init.body;
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(target, { ...init, headers: requestHeaders, body });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "no details";
    let type: string | undefined;

    try {
      const parsed = JSON.parse(detail) as {
        error?: string | { type?: string; message?: string };
      };

      if (typeof parsed.error === "string") {
        message = parsed.error;
      } else if (parsed.error) {
        type = parsed.error.type;
        message = parsed.error.message ?? detail;
        if (type) message = `${type}: ${message}`;
      }
    } catch {
      // Response was not JSON; keep the raw text.
    }

    throw new AirtableApiError(
      `Airtable request failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      type,
    );
  }

  return response;
}

/** Performs an authenticated Airtable request and parses the JSON output. */
export async function airtableRequest<T>(
  path: string,
  options: AirtableRequestOptions = {},
): Promise<T> {
  const response = await airtableFetch(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;

  return JSON.parse(text) as T;
}
