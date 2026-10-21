/**
 * In-memory stand-in for `src/mastra/tools/google/google-redis.ts`.
 *
 * Test files mock the real module with this one so auth and routes never
 * connect to Redis.
 */

import type { GoogleAccountRecord } from "../../src/mastra/tools/google/google-redis";

export const accounts = new Map<string, GoogleAccountRecord>();
export const oauthStates = new Set<string>();
export let defaultAccountEmail: string | undefined;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resetFakeGoogleStore(): void {
  accounts.clear();
  oauthStates.clear();
  defaultAccountEmail = undefined;
}

export function seedGoogleAccount(record: GoogleAccountRecord): GoogleAccountRecord {
  const email = normalizeEmail(record.email);
  const saved = { ...record, email, connectedAt: record.connectedAt ?? record.updatedAt };
  accounts.set(email, saved);
  return saved;
}

export function getStoredGoogleAccount(email: string): GoogleAccountRecord | undefined {
  return accounts.get(normalizeEmail(email));
}

export async function saveGoogleAccount(record: GoogleAccountRecord): Promise<GoogleAccountRecord> {
  const email = normalizeEmail(record.email);
  const existing = accounts.get(email);
  const now = new Date().toISOString();

  const merged: GoogleAccountRecord = {
    ...existing,
    ...record,
    email,
    refreshToken: record.refreshToken ?? existing?.refreshToken,
    connectedAt: existing?.connectedAt ?? record.connectedAt ?? now,
    updatedAt: now,
  };

  accounts.set(email, merged);
  return merged;
}

export async function getGoogleAccount(email: string): Promise<GoogleAccountRecord | null> {
  return accounts.get(normalizeEmail(email)) ?? null;
}

export async function listGoogleAccounts(): Promise<GoogleAccountRecord[]> {
  return [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export async function deleteGoogleAccount(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const removed = accounts.delete(normalized);
  if (defaultAccountEmail === normalized) defaultAccountEmail = undefined;
  return removed;
}

export async function getDefaultGoogleAccount(): Promise<string | undefined> {
  return defaultAccountEmail;
}

export async function setDefaultGoogleAccount(email: string): Promise<void> {
  defaultAccountEmail = normalizeEmail(email);
}

export async function saveOAuthState(state: string): Promise<void> {
  oauthStates.add(state);
}

export async function consumeOAuthState(state: string): Promise<boolean> {
  return oauthStates.delete(state);
}

export async function redisPing(): Promise<boolean> {
  return true;
}

export function getRedisClient(): never {
  throw new Error("Redis is not available in tests.");
}

export async function closeRedisClient(): Promise<void> {
  // no-op
}
