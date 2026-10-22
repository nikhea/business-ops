/**
 * Application tables that live alongside the Better Auth schema.
 *
 * This is a single-tenant internal application: provider credentials are shared
 * by the company, and users are provisioned by an admin.
 */

import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const providerEnum = pgEnum("provider", [
  "airtable",
  "clickup",
  "notion",
  "resend",
  "hubspot",
]);

export type Provider = (typeof providerEnum.enumValues)[number];

/**
 * One credential per provider. Values are encrypted with AES-256-GCM before
 * they reach Postgres.
 */
export const providerCredential = pgTable(
  "provider_credential",
  {
    provider: providerEnum("provider").primaryKey(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("provider_credential_provider_key").on(table.provider)],
);

/**
 * Connected Google Workspace accounts. Previously stored in Redis; refresh
 * tokens are now encrypted at rest.
 */
export const googleAccount = pgTable(
  "google_account",
  {
    email: text("email").primaryKey(),
    userId: text("user_id"),
    name: text("name"),
    picture: text("picture"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    refreshTokenIv: text("refresh_token_iv"),
    refreshTokenTag: text("refresh_token_tag"),
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenIv: text("access_token_iv"),
    accessTokenTag: text("access_token_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    tokenType: text("token_type"),
    isDefault: boolean("is_default").default(false).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("google_account_user_id_idx").on(table.userId)],
);

/**
 * Short-lived OAuth state values. Replaces the Redis `google:oauth:state:*`
 * keys while keeping the single-use guarantee.
 */
export const oauthState = pgTable("oauth_state", {
  state: text("state").primaryKey(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
