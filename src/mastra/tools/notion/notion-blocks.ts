import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  listSchema,
  notificationsBody,
  notificationsSchema,
  notionObjectSchema,
  type NotionObject,
} from "./notion-shared";
import { notionRequest } from "./notion-auth";

interface BlockListResponse {
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
}

const MAX_FETCH_PAGES = 100;

const positionSchema = z.union([
  z.object({
    type: z.literal("start"),
  }),
  z.object({
    type: z.literal("end"),
  }),
  z.object({
    type: z.literal("after_block"),
    after_block: z.object({ id: z.string().describe("Block ID to insert after") }),
  }),
]);

export const notionGetBlockTool = createTool({
  id: "notion_get_block",
  title: "Notion: get block",
  description:
    "Retrieve a block by ID. Use `notion_list_block_children` to read nested content.",
  inputSchema: z.object({
    blockId: z.string().describe("Notion block or page ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ blockId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/blocks/${encodeURIComponent(blockId)}`, {
      authContext: { requestContext },
    });
  },
});

export const notionListBlockChildrenTool = createTool({
  id: "notion_list_block_children",
  title: "Notion: list block children",
  description:
    "List the direct child blocks of a page or block. Nested blocks need a recursive call. " +
    "Set `fetchAll` to follow pagination.",
  inputSchema: z.object({
    blockId: z.string().describe("Notion block or page ID"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Blocks per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe("Follow pagination and return all children (safety cap: 10,000 / 100 pages)"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum children to return across pages"),
  }),
  outputSchema: listSchema.extend({
    fetchedAll: z.boolean(),
  }),
  execute: async (
    { blockId, pageSize, startCursor, fetchAll, maxResults },
    { requestContext },
  ) => {
    const path = `/blocks/${encodeURIComponent(blockId)}/children`;
    const fetchPage = async (cursor?: string) =>
      notionRequest<BlockListResponse>(path, {
        query: { page_size: pageSize, start_cursor: cursor },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        results: page.results ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        type: "block",
        fetchedAll: !page.has_more,
      };
    }

    const results: NotionObject[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      results.push(...(page.results ?? []));
      if (maxResults !== undefined && results.length >= maxResults) {
        return {
          results: results.slice(0, maxResults),
          nextCursor: page.next_cursor ?? null,
          hasMore: page.has_more ?? false,
          type: "block",
          fetchedAll: false,
        };
      }
      cursor = page.next_cursor ?? undefined;
      hasMore = Boolean(page.has_more);
      pages += 1;
    }

    return {
      results,
      nextCursor: hasMore ? (cursor ?? null) : null,
      hasMore,
      type: "block",
      fetchedAll: !hasMore,
    };
  },
});

export const notionAppendBlockChildrenTool = createTool({
  id: "notion_append_block_children",
  title: "Notion: append block children",
  description:
    "Append up to 100 blocks to a page or block. Blocks support up to two levels of nesting. " +
    "Use `position` to insert at the start, end, or after a specific block.",
  inputSchema: z.object({
    blockId: z.string().describe("Parent page or block ID"),
    children: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(100)
      .describe("Block objects to append, e.g. { type: 'paragraph', paragraph: { rich_text: [...] } }"),
    position: positionSchema
      .optional()
      .describe("Where to insert; defaults to the end of the parent's children"),
    notifications: notificationsSchema,
  }),
  outputSchema: listSchema,
  execute: async ({ blockId, children, position, notifications }, { requestContext }) => {
    const result = await notionRequest<BlockListResponse>(
      `/blocks/${encodeURIComponent(blockId)}/children`,
      {
        method: "PATCH",
        json: {
          children,
          ...(position ? { position } : {}),
          ...(notificationsBody(notifications) ? { notifications: notificationsBody(notifications) } : {}),
        },
        authContext: { requestContext },
      },
    );

    return {
      results: result.results ?? [],
      nextCursor: result.next_cursor ?? null,
      hasMore: result.has_more ?? false,
      type: "block",
    };
  },
});

export const notionUpdateBlockTool = createTool({
  id: "notion_update_block",
  title: "Notion: update block",
  description:
    "Update a block's content. Pass only the block-specific payload, for example " +
    "{ paragraph: { rich_text: [...] } } or { to_do: { checked: true } }. Set `inTrash` to trash it.",
  inputSchema: z.object({
    blockId: z.string().describe("Block ID"),
    block: z
      .record(z.string(), z.unknown())
      .describe("Block-specific fields to update; do not include id, object, or timestamps"),
    inTrash: z.boolean().optional().describe("Move the block to or from the trash"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ blockId, block, inTrash }, { requestContext }) => {
    const readOnlyFields = new Set([
      "object",
      "id",
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
      "has_children",
      "archived",
      "in_trash",
    ]);
    const fields = Object.fromEntries(
      Object.entries(block).filter(([key]) => !readOnlyFields.has(key)),
    );

    return notionRequest<NotionObject>(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "PATCH",
      json: {
        ...fields,
        ...(inTrash !== undefined ? { in_trash: inTrash } : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const notionDeleteBlockTool = createTool({
  id: "notion_delete_block",
  title: "Notion: delete block",
  description:
    "Move a block to the trash. Returns the deleted block object. Permanent deletion is not supported by the API.",
  inputSchema: z.object({
    blockId: z.string().describe("Block ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ blockId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });
  },
});

export const notionBlockTools = {
  notionGetBlockTool,
  notionListBlockChildrenTool,
  notionAppendBlockChildrenTool,
  notionUpdateBlockTool,
  notionDeleteBlockTool,
};
