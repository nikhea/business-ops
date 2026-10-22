/**
 * AES-256-GCM helpers for provider credentials stored in Postgres.
 *
 * The key comes from CREDENTIAL_ENCRYPTION_KEY, which is deliberately separate
 * from BETTER_AUTH_SECRET: rotating the auth secret must not make stored
 * provider tokens unreadable.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionError";
  }
}

let cachedKey: Buffer | undefined;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new CredentialEncryptionError(
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new CredentialEncryptionError(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}).`,
    );
  }

  cachedKey = key;
  return key;
}

/** Testing hook: forget the cached key so a new env value takes effect. */
export function resetEncryptionKey(): void {
  cachedKey = undefined;
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
