/**
 * Shared Resend client helpers.
 *
 * Auth resolution order:
 * 1. A per-request override in Mastra's Request Context (`resendApiKey` or
 *    `resendToken`).
 * 2. `RESEND_API_KEY` / `RESEND_TOKEN` environment variables.
 *
 * Keys are created at https://resend.com/api-keys. The SDK is used instead of
 * raw fetch so request headers, user agent, idempotency keys, and camelCase to
 * snake_case mapping stay in sync with the official client.
 */

import { Resend } from "resend";

export class ResendAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendAuthError";
  }
}

export class ResendApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResendApiError";
  }
}

export interface ResendToolContext {
  requestContext?: {
    get?: (key: string) => unknown;
  };
}

interface ResendResult<T> {
  data: T | null;
  error: {
    message: string;
    statusCode: number | null;
    name: string;
  } | null;
}

const USER_AGENT = "bussiness-ops-resend-tools/1.0";

export function resolveResendApiKey(context?: ResendToolContext): string {
  const override =
    context?.requestContext?.get?.("resendApiKey") ??
    context?.requestContext?.get?.("resendToken");

  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  const environmentKey =
    process.env.RESEND_API_KEY?.trim() || process.env.RESEND_TOKEN?.trim();

  if (environmentKey) return environmentKey;

  throw new ResendAuthError(
    "No Resend API key is configured. Set RESEND_API_KEY in the environment " +
      "(create a key at https://resend.com/api-keys) or pass `resendApiKey` " +
      "in the Request Context.",
  );
}

/** Creates an isolated Resend client for one tool call. */
export function createResendClient(context?: ResendToolContext): Resend {
  return new Resend(resolveResendApiKey(context), { userAgent: USER_AGENT });
}

/**
 * Unwraps the SDK's `{ data, error }` result and throws a typed error instead
 * of returning Resend's error object to the model.
 */
export async function resendCall<T>(
  operation: () => PromiseLike<ResendResult<T>>,
): Promise<Record<string, unknown>> {
  let result: ResendResult<T>;

  try {
    result = await operation();
  } catch (error) {
    throw new ResendApiError(
      error instanceof Error ? error.message : String(error),
      null,
      "network_error",
      { cause: error },
    );
  }

  if (result.error) {
    throw new ResendApiError(
      `Resend request failed (${result.error.statusCode ?? "unknown"}): ` +
        `${result.error.name}: ${result.error.message}`,
      result.error.statusCode,
      result.error.name,
    );
  }

  if (result.data === null) {
    throw new ResendApiError(
      "Resend returned no data and no error.",
      null,
      "empty_response",
    );
  }

  return result.data as Record<string, unknown>;
}
