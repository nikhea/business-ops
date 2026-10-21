/**
 * Shared Notion API helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`notionAccessToken`).
 * 2. `NOTION_API_TOKEN` / `NOTION_TOKEN` / `NOTION_API_KEY` environment
 *    variables. Internal connection tokens and personal access tokens both
 *    start with `ntn_`.
 *
 * The token needs read/insert/update content capabilities on the pages and
 * databases you want the tools to touch. Comments also require the comment
 * capabilities, which are off by default.
 *
 * Requests use Notion API version `2026-03-11` unless `NOTION_VERSION` is set.
 * Remember that pages and databases must be shared with the connection before
 * most endpoints work.
 */

export class NotionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionAuthError";
  }
}

export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

export interface NotionToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

export interface NotionObject {
  object: string;
  id: string;
  [key: string]: unknown;
}

const NOTION_BASE = "https://api.notion.com/v1";
const DEFAULT_NOTION_VERSION = "2026-03-11";

export function resolveNotionToken(context?: NotionToolContext): string {
  const override =
    context?.requestContext?.get?.("notionAccessToken") ??
    context?.requestContext?.get?.("notionToken");

  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const environmentToken =
    process.env.NOTION_API_TOKEN?.trim() ||
    process.env.NOTION_TOKEN?.trim() ||
    process.env.NOTION_API_KEY?.trim();

  if (environmentToken) return environmentToken;

  throw new NotionAuthError(
    "No Notion token is configured. Set NOTION_API_TOKEN in the environment " +
      "(create an internal connection at https://www.notion.so/my-integrations) " +
      "or pass `notionAccessToken` in the Request Context.",
  );
}

export function resolveNotionVersion(): string {
  return process.env.NOTION_VERSION?.trim() || DEFAULT_NOTION_VERSION;
}

export interface NotionRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  query?: Record<string, unknown>;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  authContext?: NotionToolContext;
}

function queryValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Performs an authenticated Notion request and throws on non-2xx responses. */
export async function notionFetch(
  path: string,
  options: NotionRequestOptions = {},
): Promise<Response> {
  const { query, json, headers, authContext, ...init } = options;

  const target = new URL(
    path.startsWith("http")
      ? path
      : `${NOTION_BASE}${path.startsWith("/") ? "" : "/"}${path}`,
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
  requestHeaders.set("Authorization", `Bearer ${resolveNotionToken(authContext)}`);
  requestHeaders.set("Notion-Version", resolveNotionVersion());

  let body = init.body;
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(target, { ...init, headers: requestHeaders, body });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail || "no details";
    let code: string | undefined;
    let requestId: string | undefined;

    try {
      const parsed = JSON.parse(detail) as {
        code?: string;
        message?: string;
        request_id?: string;
      };

      code = parsed.code;
      requestId = parsed.request_id;
      message = parsed.message ?? detail;
      if (code) message = `${code}: ${message}`;
    } catch {
      // Response was not JSON; keep the raw text.
    }

    throw new NotionApiError(
      `Notion request failed (${response.status} ${response.statusText}): ${message}`,
      response.status,
      code,
      requestId,
    );
  }

  return response;
}

/** Performs an authenticated Notion request and parses the JSON output. */
export async function notionRequest<T>(
  path: string,
  options: NotionRequestOptions = {},
): Promise<T> {
  const response = await notionFetch(path, options);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;

  return JSON.parse(text) as T;
}
