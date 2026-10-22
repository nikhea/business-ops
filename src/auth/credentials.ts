/**
 * Loads provider credentials into Mastra's RequestContext so the existing
 * tools keep reading the same keys (`airtableToken`, `notionToken`, ...).
 *
 * Values stored in Postgres win; when a provider has no row, the key is left
 * unset and the tools fall back to their environment variables as before.
 */

import type { RequestContext } from "@mastra/core/request-context";
import { getDb } from "../db";
import { decryptSecret } from "../db/crypto";
import { providerCredential, type Provider } from "../db/schema/app";
import { getDefaultGoogleAccount, getGoogleAccountForUser } from "../mastra/tools/google/google-store";

const PROVIDER_CONTEXT_KEYS: Record<Provider, string> = {
  airtable: "airtableToken",
  clickup: "clickupToken",
  notion: "notionToken",
  resend: "resendApiKey",
  hubspot: "hubspotToken",
};

const CACHE_TTL_MS = 30_000;

let credentialCache: { expiresAt: number; values: Record<string, string> } | undefined;

async function loadProviderCredentialValues(): Promise<Record<string, string>> {
  if (credentialCache && credentialCache.expiresAt > Date.now()) {
    return credentialCache.values;
  }

  const rows = await getDb().select().from(providerCredential);
  const values: Record<string, string> = {};

  for (const row of rows) {
    const contextKey = PROVIDER_CONTEXT_KEYS[row.provider];
    if (!contextKey) continue;

    try {
      values[contextKey] = decryptSecret({
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag,
      });
    } catch (error) {
      console.error(
        `[auth] Could not decrypt the ${row.provider} credential. Was CREDENTIAL_ENCRYPTION_KEY rotated?`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  credentialCache = { expiresAt: Date.now() + CACHE_TTL_MS, values };
  return values;
}

/** Testing hook: drop the cached credential set. */
export function resetCredentialCache(): void {
  credentialCache = undefined;
}

export async function loadCredentialContext(userId: string): Promise<Record<string, string>> {
  const values = { ...(await loadProviderCredentialValues()) };

  try {
    const linked = await getGoogleAccountForUser(userId);
    const googleEmail = linked?.email ?? (await getDefaultGoogleAccount());
    if (googleEmail) values.googleAccount = googleEmail;
  } catch (error) {
    console.error(
      "[auth] Could not resolve the Google account for this user:",
      error instanceof Error ? error.message : error,
    );
  }

  return values;
}

export async function applyCredentialContext(
  requestContext: RequestContext,
  userId: string,
): Promise<void> {
  const values = await loadCredentialContext(userId);
  for (const [key, value] of Object.entries(values)) {
    requestContext.set(key, value);
  }
}
