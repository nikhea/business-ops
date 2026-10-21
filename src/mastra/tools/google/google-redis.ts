/**
 * Redis-backed storage for connected Google accounts.
 *
 * Layout:
 *   google:account:<email>   JSON record with tokens + profile details
 *   google:accounts          set of connected account emails
 *   google:default-account   email used when a tool call does not name an account
 *   google:oauth:state:<id>  short-lived OAuth state values
 */

import Redis from "ioredis";

const ACCOUNTS_KEY = "google:accounts";
const DEFAULT_ACCOUNT_KEY = "google:default-account";
const STATE_TTL_SECONDS = 10 * 60;

const accountKey = (email: string) => `google:account:${normalizeEmail(email)}`;
const stateKey = (state: string) => `google:oauth:state:${state}`;

export interface GoogleAccountRecord {
  email: string;
  name?: string;
  picture?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  scope?: string;
  tokenType?: string;
  connectedAt?: string;
  updatedAt: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL?.trim() || process.env.REDIS_API_KEY?.trim();

    if (!url) {
      throw new Error(
        "Redis is not configured. Set REDIS_URL (or REDIS_API_KEY) to a redis:// connection URL.",
      );
    }

    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });

    client.on("error", (error: Error) => {
      console.error("[google-store] Redis error:", error.message);
    });
  }

  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (!client) return;
  const current = client;
  client = null;
  await current.quit().catch(() => current.disconnect());
}

export type GoogleAccountInput = Omit<GoogleAccountRecord, "updatedAt"> & { updatedAt?: string };

export async function saveGoogleAccount(record: GoogleAccountInput): Promise<GoogleAccountRecord> {
  const redis = getRedisClient();
  const email = normalizeEmail(record.email);
  const existing = await getGoogleAccount(email);
  const now = new Date().toISOString();

  const merged: GoogleAccountRecord = {
    ...existing,
    ...record,
    email,
    // Google only sends a refresh token on the first consent (or after forcing
    // consent), so never overwrite a stored one with an empty value.
    refreshToken: record.refreshToken ?? existing?.refreshToken,
    connectedAt: existing?.connectedAt ?? record.connectedAt ?? now,
    updatedAt: now,
  };

  await redis
    .multi()
    .set(accountKey(email), JSON.stringify(merged))
    .sadd(ACCOUNTS_KEY, email)
    .exec();

  return merged;
}

export async function getGoogleAccount(email: string): Promise<GoogleAccountRecord | null> {
  const raw = await getRedisClient().get(accountKey(email));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as GoogleAccountRecord;
  } catch {
    console.error(`[google-store] Ignoring malformed account record for ${email}`);
    return null;
  }
}

export async function listGoogleAccounts(): Promise<GoogleAccountRecord[]> {
  const redis = getRedisClient();
  const emails = await redis.smembers(ACCOUNTS_KEY);
  if (emails.length === 0) return [];

  const records = await redis.mget(...emails.map(accountKey));
  return records
    .filter((raw): raw is string => Boolean(raw))
    .map((raw) => JSON.parse(raw) as GoogleAccountRecord)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function deleteGoogleAccount(email: string): Promise<boolean> {
  const redis = getRedisClient();
  const normalized = normalizeEmail(email);
  const removed = await redis.del(accountKey(normalized));

  await redis.srem(ACCOUNTS_KEY, normalized);

  if ((await redis.get(DEFAULT_ACCOUNT_KEY)) === normalized) {
    await redis.del(DEFAULT_ACCOUNT_KEY);
  }

  return removed > 0;
}

export async function getDefaultGoogleAccount(): Promise<string | undefined> {
  const email = await getRedisClient().get(DEFAULT_ACCOUNT_KEY);
  return email ?? undefined;
}

export async function setDefaultGoogleAccount(email: string): Promise<void> {
  await getRedisClient().set(DEFAULT_ACCOUNT_KEY, normalizeEmail(email));
}

export async function saveOAuthState(state: string): Promise<void> {
  await getRedisClient().set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
}

export async function consumeOAuthState(state: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = stateKey(state);
  const exists = await redis.exists(key);
  if (!exists) return false;
  await redis.del(key);
  return true;
}

export async function redisPing(): Promise<boolean> {
  try {
    return (await getRedisClient().ping()) === "PONG";
  } catch {
    return false;
  }
}
