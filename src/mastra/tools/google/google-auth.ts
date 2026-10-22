/**
 * Shared Google API helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`googleAccessToken`).
 * 2. A connected account stored in Postgres, chosen by `googleAccount` (or
 *    `googleEmail`) in the Request Context, otherwise the default account.
 *    Expired access tokens are refreshed with the stored refresh token and the
 *    new token is written back to Postgres.
 * 3. `GOOGLE_ACCESS_TOKEN` / `GOOGLE_REFRESH_TOKEN` environment variables.
 *
 * Connect an account with `GET /google/connect`.
 */

import {
  getDefaultGoogleAccount,
  getGoogleAccount,
  saveGoogleAccount,
  type GoogleAccountRecord,
} from "./google-store";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Minimal shape of the execution context we rely on. */
export interface GoogleToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

interface RefreshTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

const pendingRefreshes = new Map<string, Promise<TokenCacheEntry>>();
let envToken: TokenCacheEntry | undefined;
let loggedStoreFailure = false;

export async function resolveGoogleAccessToken(context?: GoogleToolContext): Promise<string> {
  const override = context?.requestContext?.get?.("googleAccessToken");
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const requestedAccount =
    context?.requestContext?.get?.("googleAccount") ?? context?.requestContext?.get?.("googleEmail");
  const accountEmail =
    typeof requestedAccount === "string" && requestedAccount.trim().length > 0
      ? requestedAccount.trim()
      : await safeDefaultAccount();

  if (accountEmail) {
    const token = await getStoredAccountToken(accountEmail);
    if (token) return token;
  }

  return getEnvironmentToken();
}

async function safeDefaultAccount(): Promise<string | undefined> {
  try {
    return await getDefaultGoogleAccount();
  } catch (error) {
    reportStoreFailure(error);
    return undefined;
  }
}

async function getStoredAccountToken(email: string): Promise<string | undefined> {
  let account: GoogleAccountRecord | null;
  try {
    account = await getGoogleAccount(email);
  } catch (error) {
    reportStoreFailure(error);
    return undefined;
  }

  if (!account) return undefined;

  if (account.accessToken && (account.accessTokenExpiresAt ?? 0) - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    throw new GoogleAuthError(
      `The stored Google account ${email} has no refresh token and its access token expired. ` +
        "Reconnect it at /google/connect?force=true.",
    );
  }

  const cacheKey = `account:${email.toLowerCase()}`;
  const storedRefreshToken = account.refreshToken;
  const token = await dedupeRefresh(cacheKey, () => refreshAccessToken(storedRefreshToken));

  try {
    await saveGoogleAccount({
      ...account,
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.expiresAt,
      refreshToken: token.refreshToken ?? account.refreshToken,
      scope: token.scope ?? account.scope,
    });
  } catch (error) {
    reportStoreFailure(error);
  }

  return token.accessToken;
}

async function getEnvironmentToken(): Promise<string> {
  if (envToken && envToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return envToken.accessToken;
  }

  const staticToken = process.env.GOOGLE_ACCESS_TOKEN?.trim();
  if (staticToken) {
    envToken = { accessToken: staticToken, expiresAt: Date.now() + 10 * 60_000 };
    return envToken.accessToken;
  }

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!refreshToken) {
    throw new GoogleAuthError(
      "No Google account is connected. Open /google/connect to authorize one, " +
        "or set GOOGLE_REFRESH_TOKEN in the environment.",
    );
  }

  envToken = await dedupeRefresh("env", () => refreshAccessToken(refreshToken));
  return envToken.accessToken;
}

function dedupeRefresh(key: string, refresh: () => Promise<TokenCacheEntry>): Promise<TokenCacheEntry> {
  let pending = pendingRefreshes.get(key);
  if (!pending) {
    pending = refresh().finally(() => {
      pendingRefreshes.delete(key);
    });
    pendingRefreshes.set(key, pending);
  }
  return pending;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenCacheEntry> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required to refresh Google access tokens.",
    );
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GoogleAuthError(
      `Failed to refresh the Google access token (${response.status}): ${detail}. ` +
        "The grant may have been revoked; reconnect at /google/connect.",
    );
  }

  const token = (await response.json()) as RefreshTokenResponse;
  if (!token.access_token) {
    throw new GoogleAuthError("Google token endpoint did not return an access token.");
  }

  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    refreshToken: token.refresh_token,
    scope: token.scope,
  };
}

function reportStoreFailure(error: unknown) {
  if (loggedStoreFailure) return;
  loggedStoreFailure = true;
  console.error(
    "[google-auth] Could not read Google credentials from Postgres; falling back to environment credentials:",
    error instanceof Error ? error.message : error,
  );
}

export interface GoogleRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  query?: Record<string, unknown>;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  authContext?: GoogleToolContext;
}

/** Performs an authenticated Google API request and throws on non-2xx responses. */
export async function googleFetch(url: string, options: GoogleRequestOptions = {}): Promise<Response> {
  const { query, json, headers, authContext, ...init } = options;

  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) target.searchParams.append(key, String(item));
    } else {
      target.searchParams.set(key, String(value));
    }
  }

  const accessToken = await resolveGoogleAccessToken(authContext);
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Authorization", `Bearer ${accessToken}`);

  let body = init.body;
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(target, { ...init, headers: requestHeaders, body });

  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      message = parsed.error?.message ?? detail;
    } catch {
      // Response was not JSON; keep the raw text.
    }
    throw new GoogleApiError(
      `Google API request failed (${response.status} ${response.statusText}): ${message || "no details"}`,
      response.status,
    );
  }

  return response;
}

/** Performs an authenticated Google API request and parses JSON (or text) output. */
export async function googleRequest<T>(url: string, options: GoogleRequestOptions = {}): Promise<T> {
  const response = await googleFetch(url, options);

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

/** Strips CR/LF from header-ish values so user input cannot inject MIME headers. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Runs async work over a list with a fixed concurrency limit. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await map(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
