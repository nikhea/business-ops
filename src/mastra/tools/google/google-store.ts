/**
 * Postgres-backed storage for connected Google accounts.
 *
 * Layout:
 *   google_account   one row per connected account, tokens encrypted at rest
 *   oauth_state      short-lived, single-use OAuth state values
 *
 * This replaces the previous Redis implementation. Function signatures are
 * unchanged so the Google tools and OAuth routes keep working.
 */

import { and, eq, gt, lt } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../../../db/crypto";
import { getDb } from "../../../db";
import { googleAccount, oauthState } from "../../../db/schema/app";

const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleAccountRecord {
  email: string;
  userId?: string;
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

interface EncryptedParts {
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
}

function encryptToken(value: string | undefined | null): EncryptedParts {
  if (!value) return { ciphertext: null, iv: null, tag: null };
  const encrypted = encryptSecret(value);
  return { ciphertext: encrypted.ciphertext, iv: encrypted.iv, tag: encrypted.tag };
}

function decryptToken(parts: EncryptedParts): string | undefined {
  if (!parts.ciphertext || !parts.iv || !parts.tag) return undefined;

  try {
    return decryptSecret({
      ciphertext: parts.ciphertext,
      iv: parts.iv,
      tag: parts.tag,
    });
  } catch (error) {
    console.error(
      "[google-store] Could not decrypt a stored Google token. Was CREDENTIAL_ENCRYPTION_KEY rotated?",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

type GoogleAccountRow = typeof googleAccount.$inferSelect;

function toRecord(row: GoogleAccountRow): GoogleAccountRecord {
  return {
    email: row.email,
    userId: row.userId ?? undefined,
    name: row.name ?? undefined,
    picture: row.picture ?? undefined,
    refreshToken: decryptToken({
      ciphertext: row.refreshTokenCiphertext,
      iv: row.refreshTokenIv,
      tag: row.refreshTokenTag,
    }),
    accessToken: decryptToken({
      ciphertext: row.accessTokenCiphertext,
      iv: row.accessTokenIv,
      tag: row.accessTokenTag,
    }),
    accessTokenExpiresAt: row.accessTokenExpiresAt?.getTime(),
    scope: row.scope ?? undefined,
    tokenType: row.tokenType ?? undefined,
    connectedAt: row.connectedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type GoogleAccountInput = Omit<GoogleAccountRecord, "updatedAt"> & { updatedAt?: string };

export async function saveGoogleAccount(record: GoogleAccountInput): Promise<GoogleAccountRecord> {
  const email = normalizeEmail(record.email);
  const existing = await getGoogleAccount(email);
  const now = new Date();

  const refreshToken = record.refreshToken ?? existing?.refreshToken;
  const accessToken = record.accessToken ?? existing?.accessToken;
  const accessTokenExpiresAt =
    record.accessTokenExpiresAt ?? existing?.accessTokenExpiresAt ?? null;

  const refresh = encryptToken(refreshToken);
  const access = encryptToken(accessToken);

  const values = {
    email,
    userId: record.userId ?? existing?.userId ?? null,
    name: record.name ?? existing?.name ?? null,
    picture: record.picture ?? existing?.picture ?? null,
    refreshTokenCiphertext: refresh.ciphertext,
    refreshTokenIv: refresh.iv,
    refreshTokenTag: refresh.tag,
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenExpiresAt: accessTokenExpiresAt ? new Date(accessTokenExpiresAt) : null,
    scope: record.scope ?? existing?.scope ?? null,
    tokenType: record.tokenType ?? existing?.tokenType ?? null,
    updatedAt: now,
  };

  await getDb()
    .insert(googleAccount)
    .values(values)
    .onConflictDoUpdate({ target: googleAccount.email, set: values });

  return {
    ...record,
    email,
    refreshToken,
    accessToken,
    accessTokenExpiresAt: accessTokenExpiresAt ?? undefined,
    connectedAt: existing?.connectedAt ?? record.connectedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function getGoogleAccount(email: string): Promise<GoogleAccountRecord | null> {
  const rows = await getDb()
    .select()
    .from(googleAccount)
    .where(eq(googleAccount.email, normalizeEmail(email)))
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listGoogleAccounts(): Promise<GoogleAccountRecord[]> {
  const rows = await getDb().select().from(googleAccount).orderBy(googleAccount.email);
  return rows.map(toRecord);
}

export async function deleteGoogleAccount(email: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(googleAccount)
    .where(eq(googleAccount.email, normalizeEmail(email)))
    .returning({ email: googleAccount.email });

  return deleted.length > 0;
}

export async function getDefaultGoogleAccount(): Promise<string | undefined> {
  const rows = await getDb()
    .select({ email: googleAccount.email })
    .from(googleAccount)
    .where(eq(googleAccount.isDefault, true))
    .limit(1);

  return rows[0]?.email;
}

export async function setDefaultGoogleAccount(email: string): Promise<void> {
  const target = normalizeEmail(email);

  await getDb().transaction(async (tx) => {
    await tx.update(googleAccount).set({ isDefault: false }).where(eq(googleAccount.isDefault, true));
    await tx
      .update(googleAccount)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(googleAccount.email, target));
  });
}

/** Finds the account linked to a user, if any. */
export async function getGoogleAccountForUser(userId: string): Promise<GoogleAccountRecord | null> {
  const rows = await getDb()
    .select()
    .from(googleAccount)
    .where(eq(googleAccount.userId, userId))
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}

export async function saveOAuthState(state: string, userId?: string): Promise<void> {
  const now = new Date();

  // Opportunistic cleanup keeps the table from accumulating abandoned states.
  await getDb().delete(oauthState).where(lt(oauthState.expiresAt, now));

  await getDb()
    .insert(oauthState)
    .values({
      state,
      userId: userId ?? null,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    })
    .onConflictDoUpdate({
      target: oauthState.state,
      set: { expiresAt: new Date(now.getTime() + STATE_TTL_MS) },
    });
}

export async function consumeOAuthState(state: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(oauthState)
    .where(and(eq(oauthState.state, state), gt(oauthState.expiresAt, new Date())))
    .returning({ state: oauthState.state });

  return deleted.length > 0;
}

/** No-op kept for scripts that used to close a Redis connection. */
export async function closeGoogleStore(): Promise<void> {}
