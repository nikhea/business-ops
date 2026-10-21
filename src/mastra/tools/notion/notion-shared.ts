import { z } from "zod";

export type { NotionObject } from "./notion-auth";

/** A Notion object with the fields shared by pages, blocks, users, and comments. */
export const notionObjectSchema = z.looseObject({
  object: z.string(),
  id: z.string(),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  in_trash: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  is_locked: z.boolean().optional(),
  url: z.string().optional(),
  public_url: z.string().nullable().optional(),
  parent: z.unknown().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  icon: z.unknown().nullable().optional(),
  cover: z.unknown().nullable().optional(),
  created_by: z.unknown().optional(),
  last_edited_by: z.unknown().optional(),
  title: z.array(z.unknown()).optional(),
  description: z.array(z.unknown()).optional(),
  database_type: z.string().nullable().optional(),
  is_inline: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const pageMarkdownSchema = z.looseObject({
  object: z.string(),
  id: z.string(),
  markdown: z.string().optional(),
  truncated: z.boolean().optional(),
  unknown_block_ids: z.array(z.string()).optional(),
  warnings: z
    .array(z.looseObject({ code: z.string(), message: z.string() }))
    .optional(),
});

export const listSchema = z.object({
  results: z.array(notionObjectSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  type: z.string().optional(),
  requestStatus: z.unknown().optional(),
});

export type NotionList = z.infer<typeof listSchema>;

/** Build Notion's minimal rich text array for a plain string. */
export function richText(content: string): { type: "text"; text: { content: string } }[] {
  return [{ type: "text", text: { content } }];
}

/** Add a title property to a page's property map. */
export function withTitleProperty(
  properties: Record<string, unknown> | undefined,
  title: string | undefined,
  titleProperty = "title",
): Record<string, unknown> | undefined {
  if (title === undefined) return properties;

  return {
    ...(properties ?? {}),
    [titleProperty]: { title: richText(title) },
  };
}

export interface ParentInput {
  type?: "page_id" | "database_id" | "data_source_id" | "workspace";
  page_id?: string;
  database_id?: string;
  data_source_id?: string;
  workspace?: boolean;
}

export type NormalizedParent =
  | { type: "page_id"; page_id: string }
  | { type: "database_id"; database_id: string }
  | { type: "data_source_id"; data_source_id: string }
  | { type: "workspace"; workspace: true };

/**
 * Turn the tool-friendly parent object into the exact shape Notion expects.
 * Exactly one of page_id, database_id, data_source_id, or workspace is needed.
 */
export function normalizeParent(
  parent: ParentInput,
  allowed: ("page_id" | "database_id" | "data_source_id" | "workspace")[] = [
    "page_id",
    "database_id",
    "data_source_id",
    "workspace",
  ],
): NormalizedParent {
  const keys = (["page_id", "database_id", "data_source_id", "workspace"] as const).filter(
    (key) => {
      const value = parent[key];
      return key === "workspace" ? value === true : typeof value === "string" && value.length > 0;
    },
  );

  if (keys.length !== 1) {
    throw new Error("parent must contain exactly one of page_id, database_id, data_source_id, or workspace.");
  }

  const key = keys[0];

  if (!allowed.includes(key)) {
    throw new Error(`parent type '${key}' is not supported for this operation.`);
  }

  if (parent.type && parent.type !== key) {
    throw new Error(`parent.type '${parent.type}' does not match parent.${key}.`);
  }

  if (key === "workspace") {
    return { type: "workspace", workspace: true };
  }

  const value = parent[key];
  if (typeof value !== "string") {
    throw new Error(`parent.${key} must be a string.`);
  }

  return { type: key, [key]: value } as NormalizedParent;
}

export const parentInputSchema = z.object({
  type: z
    .enum(["page_id", "database_id", "data_source_id", "workspace"])
    .optional()
    .describe("Optional parent type; inferred from the ID field"),
  page_id: z.string().optional().describe("Parent page ID"),
  database_id: z.string().optional().describe("Parent database ID"),
  data_source_id: z.string().optional().describe("Parent data source ID"),
  workspace: z.boolean().optional().describe("Create as a private workspace-level page"),
});

export const notificationsSchema = z
  .enum(["default", "silent"])
  .optional()
  .describe("Set to 'silent' to skip page update and mention notifications");

export function notificationsBody(
  mode: "default" | "silent" | undefined,
): { mode: "default" | "silent" } | undefined {
  return mode ? { mode } : undefined;
}
