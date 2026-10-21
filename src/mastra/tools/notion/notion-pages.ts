import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  normalizeParent,
  notificationsBody,
  notificationsSchema,
  notionObjectSchema,
  parentInputSchema,
  withTitleProperty,
  type NotionObject,
} from "./notion-shared";
import { notionRequest } from "./notion-auth";

const blockChildrenSchema = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(100)
  .describe("Block objects, e.g. { type: 'paragraph', paragraph: { rich_text: [...] } }");

const pagePositionSchema = z.union([
  z.object({ type: z.literal("page_start") }),
  z.object({ type: z.literal("page_end") }),
  z.object({
    type: z.literal("after_block"),
    after_block: z.object({ id: z.string() }),
  }),
]);

export const notionCreatePageTool = createTool({
  id: "notion_create_page",
  title: "Notion: create page",
  description:
    "Create a page under a page, database/data source, or at the workspace level. " +
    "For database pages, pass property values keyed by property name or ID. Use `title` as a " +
    "shortcut for the title property, or `markdown` to create content in one call.",
  inputSchema: z.object({
    parent: parentInputSchema,
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Property values keyed by property name or ID"),
    title: z.string().optional().describe("Convenience title; merged into properties"),
    titleProperty: z
      .string()
      .default("title")
      .describe("Property name used for the `title` shortcut (often 'title' or 'Name')"),
    children: blockChildrenSchema.optional(),
    markdown: z
      .string()
      .optional()
      .describe("Page content as Markdown; mutually exclusive with children"),
    markdownVersion: z
      .enum(["v1", "v2"])
      .optional()
      .describe("Markdown syntax; v1 is enhanced markdown, v2 is Notion-flavored Markdown"),
    allowAsync: z
      .boolean()
      .default(false)
      .describe("Return an async task for large markdown writes instead of waiting"),
    icon: z.unknown().optional().describe("Notion icon object"),
    cover: z.unknown().optional().describe("Notion cover object"),
    template: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Template object, e.g. { type: 'default' } or { type: 'template_id', template_id }"),
    position: pagePositionSchema.optional().describe("Where to place the new page"),
    notifications: notificationsSchema,
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    {
      parent,
      properties,
      title,
      titleProperty,
      children,
      markdown,
      markdownVersion,
      allowAsync,
      icon,
      cover,
      template,
      position,
      notifications,
    },
    { requestContext },
  ) => {
    if (markdown !== undefined && children !== undefined) {
      throw new Error("markdown and children are mutually exclusive.");
    }
    if (markdown === undefined && (markdownVersion !== undefined || allowAsync)) {
      throw new Error("markdownVersion and allowAsync require markdown.");
    }

    const normalizedParent = normalizeParent(parent);
    const mergedProperties = withTitleProperty(properties, title, titleProperty);

    return notionRequest<NotionObject>("/pages", {
      method: "POST",
      json: {
        parent: normalizedParent,
        ...(mergedProperties !== undefined ? { properties: mergedProperties } : {}),
        ...(children !== undefined ? { children } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(markdownVersion !== undefined ? { markdown_version: markdownVersion } : {}),
        ...(markdown !== undefined ? { allow_async: allowAsync } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(cover !== undefined ? { cover } : {}),
        ...(template !== undefined ? { template } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(notificationsBody(notifications)
          ? { notifications: notificationsBody(notifications) }
          : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const notionGetPageTool = createTool({
  id: "notion_get_page",
  title: "Notion: get page",
  description:
    "Retrieve a page's properties and metadata. Use `filterProperties` to reduce the response.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
    filterProperties: z
      .array(z.string())
      .optional()
      .describe("Only return these property names or IDs"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ pageId, filterProperties }, { requestContext }) => {
    return notionRequest<NotionObject>(`/pages/${encodeURIComponent(pageId)}`, {
      query: { filter_properties: filterProperties },
      authContext: { requestContext },
    });
  },
});

export const notionUpdatePageTool = createTool({
  id: "notion_update_page",
  title: "Notion: update page",
  description:
    "Update page property values, icon, cover, lock state, or trash state. Omitted properties " +
    "keep their values. Use `notion_append_block_children` to add content.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Property values keyed by property name or ID"),
    title: z.string().optional().describe("Convenience title; merged into properties"),
    titleProperty: z
      .string()
      .default("title")
      .describe("Property name used for the `title` shortcut"),
    icon: z.unknown().optional().describe("Notion icon object"),
    cover: z.unknown().optional().describe("Notion cover object"),
    inTrash: z.boolean().optional().describe("Move the page to or from the trash"),
    isArchived: z.boolean().optional().describe("Whether the page is archived"),
    isLocked: z.boolean().optional().describe("Lock or unlock the page in the Notion UI"),
    template: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Template object to apply"),
    eraseContent: z
      .boolean()
      .optional()
      .describe("Erase all block children before applying a template (destructive)"),
    notifications: notificationsSchema,
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    {
      pageId,
      properties,
      title,
      titleProperty,
      icon,
      cover,
      inTrash,
      isArchived,
      isLocked,
      template,
      eraseContent,
      notifications,
    },
    { requestContext },
  ) => {
    const mergedProperties = withTitleProperty(properties, title, titleProperty);
    const body = {
      ...(mergedProperties !== undefined ? { properties: mergedProperties } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(cover !== undefined ? { cover } : {}),
      ...(inTrash !== undefined ? { in_trash: inTrash } : {}),
      ...(isArchived !== undefined ? { is_archived: isArchived } : {}),
      ...(isLocked !== undefined ? { is_locked: isLocked } : {}),
      ...(template !== undefined ? { template } : {}),
      ...(eraseContent !== undefined ? { erase_content: eraseContent } : {}),
      ...(notificationsBody(notifications)
        ? { notifications: notificationsBody(notifications) }
        : {}),
    };

    if (Object.keys(body).length === 0) {
      throw new Error("Provide at least one page field to update.");
    }

    return notionRequest<NotionObject>(`/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      json: body,
      authContext: { requestContext },
    });
  },
});

export const notionTrashPageTool = createTool({
  id: "notion_trash_page",
  title: "Notion: trash page",
  description: "Move a page to the trash. Use `notion_restore_page` to restore it.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ pageId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      json: { in_trash: true },
      authContext: { requestContext },
    });
  },
});

export const notionRestorePageTool = createTool({
  id: "notion_restore_page",
  title: "Notion: restore page",
  description: "Restore a page from the trash.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ pageId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      json: { in_trash: false },
      authContext: { requestContext },
    });
  },
});

export const notionMovePageTool = createTool({
  id: "notion_move_page",
  title: "Notion: move page",
  description:
    "Move a page under another page or into a data source. Moving databases and other blocks is not supported.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
    parent: parentInputSchema,
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ pageId, parent }, { requestContext }) => {
    const normalizedParent = normalizeParent(parent, ["page_id", "data_source_id"]);

    return notionRequest<NotionObject>(`/pages/${encodeURIComponent(pageId)}/move`, {
      method: "POST",
      json: { parent: normalizedParent },
      authContext: { requestContext },
    });
  },
});

export const notionGetPagePropertyTool = createTool({
  id: "notion_get_page_property",
  title: "Notion: get page property",
  description:
    "Retrieve one page property item. Use this for formula, rollup, relation, or people values " +
    "that may be truncated in the page response.",
  inputSchema: z.object({
    pageId: z.string().describe("Notion page ID"),
    propertyId: z.string().describe("Property ID or name"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Items per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
  }),
  outputSchema: z.record(z.string(), z.unknown()),
  execute: async ({ pageId, propertyId, pageSize, startCursor }, { requestContext }) => {
    return notionRequest<Record<string, unknown>>(
      `/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}`,
      {
        query: { page_size: pageSize, start_cursor: startCursor },
        authContext: { requestContext },
      },
    );
  },
});

export const notionPageTools = {
  notionCreatePageTool,
  notionGetPageTool,
  notionUpdatePageTool,
  notionTrashPageTool,
  notionRestorePageTool,
  notionMovePageTool,
  notionGetPagePropertyTool,
};
