import { z } from "zod";
import type { PaginationOptions } from "resend";

/**
 * Resend responses vary by resource and change as the API evolves. Passing
 * them through as records preserves every field while still giving Mastra an
 * output schema to validate.
 */
export const resendRecordSchema = z.record(z.string(), z.unknown());
export const resendMutationSchema = z.record(z.string(), z.unknown());
export const resendListSchema = z.record(z.string(), z.unknown());

export const resendPaginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Items per page (1-100)"),
  after: z.string().optional().describe("Cursor after which to start retrieving items"),
  before: z.string().optional().describe("Cursor before which to start retrieving items"),
});

export interface ResendPaginationInput {
  limit?: number;
  after?: string;
  before?: string;
}

/** Normalizes pagination input and rejects the mutually exclusive cursors. */
export function paginationOptions(input: ResendPaginationInput): PaginationOptions {
  if (input.after && input.before) {
    throw new Error("Use either `after` or `before`, not both.");
  }

  return {
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.before ? { before: input.before } : {}),
  } as PaginationOptions;
}

export interface ContactSelectorInput {
  contactId?: string;
  email?: string;
}

/** Returns a single contact identifier, accepting either an ID or an email. */
export function contactSelector(input: ContactSelectorInput): string {
  if (input.contactId && input.email) {
    throw new Error("Provide either contactId or email, not both.");
  }

  if (input.contactId) return input.contactId;
  if (input.email) return input.email;

  throw new Error("Provide contactId or email.");
}

export type ContactSelectorObject =
  | { id: string; email?: never }
  | { id?: never; email: string };

export function contactSelectorObject(
  input: ContactSelectorInput,
): ContactSelectorObject {
  if (input.contactId && input.email) {
    throw new Error("Provide either contactId or email, not both.");
  }

  if (input.contactId) return { id: input.contactId };
  if (input.email) return { email: input.email };

  throw new Error("Provide contactId or email.");
}

export const contactSelectorSchema = z.object({
  contactId: z.string().optional().describe("Contact ID"),
  email: z.string().email().optional().describe("Contact email address"),
});

export function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
