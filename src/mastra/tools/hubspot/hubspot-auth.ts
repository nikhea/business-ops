/**
 * Shared HubSpot API helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`hubspotAccessToken`
 *    or `hubspotToken`).
 * 2. `HUBSPOT_ACCESS_TOKEN` / `HUBSPOT_TOKEN` / `HUBSPOT_PRIVATE_APP_TOKEN`
 *    environment variables.
 *
 * Private app tokens start with `pat-`. EU accounts use a regional API host,
 * so `pat-eu...` tokens default to `https://api-eu1.hubapi.com`. Set
 * `HUBSPOT_BASE_URL` to override the host.
 */

export class HubspotAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubspotAuthError";
  }
}

export class HubspotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId?: string,
    readonly category?: string,
  ) {
    super(message);
    this.name = "HubspotApiError";
  }
}

export interface HubspotToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

const DEFAULT_BASE_URL = "https://api.hubapi.com";
const EU_BASE_URL = "https://api-eu1.hubapi.com";
const USER_AGENT = "bussiness-ops-hubspot-tools/1.0";

export function resolveHubspotToken(context?: HubspotToolContext): string {
  const override =
    context?.requestContext?.get?.("hubspotAccessToken") ??
    context?.requestContext?.get?.("hubspotToken");

  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const environmentToken =
    process.env.HUBSPOT_ACCESS_TOKEN?.trim() ||
    process.env.HUBSPOT_TOKEN?.trim() ||
    process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim();

  if (environmentToken) return environmentToken;

  throw new HubspotAuthError(
    "No HubSpot access token is configured. Set HUBSPOT_ACCESS_TOKEN in the " +
      "environment (create a private app at https://app.hubspot.com/private-apps) " +
      "or pass `hubspotAccessToken` in the Request Context.",
  );
}

/** Resolves the regional API host for the token. */
export function resolveHubspotBaseUrl(token?: string): string {
  const configured = process.env.HUBSPOT_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const resolvedToken = token ?? process.env.HUBSPOT_ACCESS_TOKEN?.trim() ?? "";
  return resolvedToken.startsWith("pat-eu") ? EU_BASE_URL : DEFAULT_BASE_URL;
}

export interface HubspotRequestOptions
  extends Omit<RequestInit, "body" | "headers"> {
  query?: Record<string, unknown>;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  authContext?: HubspotToolContext;
}

function queryValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((entry) => queryValue(entry)).join(",");
  return String(value);
}

/** Performs an authenticated HubSpot request and throws on non-2xx responses. */
export async function hubspotFetch(
  path: string,
  options: HubspotRequestOptions = {},
): Promise<Response> {
  const { query, json, headers, authContext, ...init } = options;
  const token = resolveHubspotToken(authContext);
  const baseUrl = resolveHubspotBaseUrl(token);

  const target = new URL(
    path.startsWith("http")
      ? path
      : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      target.searchParams.set(key, queryValue(value));
    } else {
      target.searchParams.set(key, queryValue(value));
    }
  }

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Authorization", `Bearer ${token}`);
  requestHeaders.set("Accept", "application/json");
  requestHeaders.set("User-Agent", USER_AGENT);

  let body = init.body;
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(target, { ...init, headers: requestHeaders, body });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "no details";
    let correlationId: string | undefined;
    let category: string | undefined;

    try {
      const parsed = JSON.parse(detail) as {
        message?: string;
        correlationId?: string;
        category?: string;
        errors?: Array<{ message?: string; context?: unknown }>;
      };

      correlationId = parsed.correlationId;
      category = parsed.category;
      message = parsed.message ?? detail;

      const nested = parsed.errors
        ?.map((error) => error.message)
        .filter((value): value is string => Boolean(value));

      if (nested && nested.length > 0) {
        message = `${message}: ${nested.join("; ")}`;
      }
    } catch {
      // Response was not JSON; keep the raw text.
    }

    throw new HubspotApiError(
      `HubSpot request failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      correlationId,
      category,
    );
  }

  return response;
}

/** Performs an authenticated HubSpot request and parses the JSON output. */
export async function hubspotRequest<T>(
  path: string,
  options: HubspotRequestOptions = {},
): Promise<T> {
  const response = await hubspotFetch(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;

  return JSON.parse(text) as T;
}
