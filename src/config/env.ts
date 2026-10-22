/**
 * Environment validation.
 *
 * Runs once at boot so that a misconfigured deployment fails loudly instead of
 * serving requests with a broken base URL, a missing database name, or a weak
 * secret. Never logs secret values.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const MIN_SECRET_LENGTH = 32;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new ConfigError(`Missing required environment variable: ${name}`);
  return value;
}

export function databaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export function betterAuthUrl(): string {
  return requireEnv("BETTER_AUTH_URL").replace(/\/+$/, "");
}

function validateUrl(name: string, errors: string[]): URL | undefined {
  const raw = readEnv(name);
  if (!raw) {
    errors.push(`${name} is required (the public origin of this server, e.g. http://localhost:5000).`);
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`${name} must be an absolute URL, got "${raw}".`);
    return undefined;
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    errors.push(`${name} must be an origin without a path, got "${raw}".`);
  }
  if (url.search || url.hash) {
    errors.push(`${name} must not contain a query string or fragment, got "${raw}".`);
  }
  return url;
}

function validateDatabaseUrl(errors: string[]): void {
  const raw = readEnv("DATABASE_URL");
  if (!raw) {
    errors.push("DATABASE_URL is required.");
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push("DATABASE_URL must be a connection URL (postgres://user:pass@host:5432/database).");
    return;
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    errors.push(`DATABASE_URL must use the postgres:// scheme, got "${url.protocol}".`);
  }
  if (!url.username) {
    errors.push("DATABASE_URL is missing a username.");
  }
  // A trailing slash with no database name silently connects to a database
  // named after the user, so migrations land in the wrong place.
  if (!url.pathname || url.pathname === "/") {
    errors.push("DATABASE_URL is missing a database name.");
  }
}

function validateEncryptionKey(errors: string[]): void {
  const raw = readEnv("CREDENTIAL_ENCRYPTION_KEY");
  if (!raw) {
    errors.push(
      "CREDENTIAL_ENCRYPTION_KEY is required. Generate one with: openssl rand -base64 32",
    );
    return;
  }

  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    errors.push(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (got ${bytes.length}). Generate one with: openssl rand -base64 32`,
    );
  }
}

export function validateEnv(): void {
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  validateDatabaseUrl(errors);

  const baseUrl = validateUrl("BETTER_AUTH_URL", errors);
  if (baseUrl) {
    const isLocal = LOCAL_HOSTNAMES.has(baseUrl.hostname);
    if (isProduction && isLocal) {
      errors.push("BETTER_AUTH_URL must be a public host in production, not localhost.");
    }
    if (isProduction && baseUrl.protocol !== "https:") {
      errors.push("BETTER_AUTH_URL must use https:// in production.");
    }
  }

  const secret = readEnv("BETTER_AUTH_SECRET");
  if (!secret) {
    errors.push("BETTER_AUTH_SECRET is required. Generate one with: openssl rand -base64 32");
  } else if (secret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}).`,
    );
  }

  // Separate secret: Studio JWTs must not be signed with the auth or
  // credential-encryption keys.
  const studioSecret = readEnv("MASTRA_JWT_SECRET");
  if (!studioSecret) {
    errors.push("MASTRA_JWT_SECRET is required for Studio. Generate one with: openssl rand -base64 32");
  } else if (studioSecret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `MASTRA_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${studioSecret.length}).`,
    );
  }

  validateEncryptionKey(errors);

  if (errors.length > 0) {
    throw new ConfigError(
      ["Invalid environment configuration:", ...errors.map((error) => `  - ${error}`)].join("\n"),
    );
  }
}
