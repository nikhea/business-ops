import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pageMarkdownSchema } from "./notion-shared";
import { notionRequest } from "./notion-auth";

const markdownVersionSchema = z
  .enum(["v1", "v2"])
  .optional()
  .describe("Markdown syntax; v1 is enhanced markdown, v2 is Notion-flavored Markdown");

const positionSchema = z.union([
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("end") }),
]);

export const notionRetrievePageMarkdownTool = createTool({
  id: "notion_retrieve_page_markdown",
  title: "Notion: retrieve page as Markdown",
  description:
    "Read a page's full content as Markdown in one call. Prefer this over recursively walking blocks. " +
    "The response flags truncated content and returns unknown block IDs you can fetch separately.",
  inputSchema: z.object({
    pageId: z.string().describe("Page or block ID to read"),
    includeTranscript: z
      .boolean()
      .default(false)
      .describe("Include full meeting-note transcripts"),
    markdownVersion: markdownVersionSchema,
  }),
  outputSchema: pageMarkdownSchema,
  execute: async ({ pageId, includeTranscript, markdownVersion }, { requestContext }) => {
    return notionRequest<z.infer<typeof pageMarkdownSchema>>(
      `/pages/${encodeURIComponent(pageId)}/markdown`,
      {
        query: {
          include_transcript: includeTranscript,
          markdown_version: markdownVersion,
        },
        authContext: { requestContext },
      },
    );
  },
});

export const notionUpdatePageMarkdownTool = createTool({
  id: "notion_update_page_markdown",
  title: "Notion: update page content as Markdown",
  description:
    "Edit page content using Markdown. `update_content` performs precise search-and-replace edits; " +
    "`replace_content` rewrites the whole page. `insert_content` and `replace_content_range` remain " +
    "available but are legacy.",
  inputSchema: z
    .object({
      pageId: z.string().describe("Page ID"),
      command: z
        .enum(["update_content", "replace_content", "insert_content", "replace_content_range"])
        .describe("Markdown edit operation"),
      contentUpdates: z
        .array(
          z.object({
            oldStr: z.string().min(1).describe("Existing text to find"),
            newStr: z.string().describe("Replacement text"),
            replaceAllMatches: z
              .boolean()
              .default(false)
              .describe("Replace every match instead of failing on multiple matches"),
          }),
        )
        .min(1)
        .max(100)
        .optional()
        .describe("Required for update_content"),
      newStr: z.string().optional().describe("Required for replace_content"),
      content: z.string().optional().describe("Required for insert_content and replace_content_range"),
      contentRange: z
        .string()
        .optional()
        .describe("Required for replace_content_range, in 'start text...end text' form"),
      after: z
        .string()
        .optional()
        .describe("For insert_content: insert after this 'start text...end text' selection"),
      position: positionSchema
        .optional()
        .describe("For insert_content: insert at the start or end"),
      allowDeletingContent: z
        .boolean()
        .default(false)
        .describe("Allow edits that delete child pages or databases"),
      allowAsync: z
        .boolean()
        .default(false)
        .describe("Return an async task instead of waiting for a large edit"),
      markdownVersion: markdownVersionSchema,
    })
    .superRefine((value, ctx) => {
      if (value.command === "update_content" && !value.contentUpdates?.length) {
        ctx.addIssue({
          code: "custom",
          message: "contentUpdates is required for update_content.",
          path: ["contentUpdates"],
        });
      }
      if (value.command === "replace_content" && value.newStr === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "newStr is required for replace_content.",
          path: ["newStr"],
        });
      }
      if (
        (value.command === "insert_content" || value.command === "replace_content_range") &&
        value.content === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          message: "content is required for insert_content and replace_content_range.",
          path: ["content"],
        });
      }
      if (value.command === "replace_content_range" && value.contentRange === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "contentRange is required for replace_content_range.",
          path: ["contentRange"],
        });
      }
      if (value.after !== undefined && value.position !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "after and position cannot both be provided.",
          path: ["position"],
        });
      }
    }),
  outputSchema: pageMarkdownSchema,
  execute: async (
    {
      pageId,
      command,
      contentUpdates,
      newStr,
      content,
      contentRange,
      after,
      position,
      allowDeletingContent,
      allowAsync,
      markdownVersion,
    },
    { requestContext },
  ) => {
    const body: Record<string, unknown> = {
      type: command,
      ...(allowAsync ? { allow_async: true } : {}),
      ...(markdownVersion !== undefined ? { markdown_version: markdownVersion } : {}),
    };

    if (command === "update_content") {
      body.update_content = {
        content_updates: (contentUpdates ?? []).map(
          (update: { oldStr: string; newStr: string; replaceAllMatches: boolean }) => ({
            old_str: update.oldStr,
            new_str: update.newStr,
            ...(update.replaceAllMatches ? { replace_all_matches: true } : {}),
          }),
        ),
        ...(allowDeletingContent ? { allow_deleting_content: true } : {}),
      };
    } else if (command === "replace_content") {
      body.replace_content = {
        new_str: newStr,
        ...(allowDeletingContent ? { allow_deleting_content: true } : {}),
      };
    } else if (command === "insert_content") {
      body.insert_content = {
        content,
        ...(after !== undefined ? { after } : {}),
        ...(position !== undefined ? { position } : {}),
      };
    } else {
      body.replace_content_range = {
        content,
        content_range: contentRange,
        ...(allowDeletingContent ? { allow_deleting_content: true } : {}),
      };
    }

    return notionRequest<z.infer<typeof pageMarkdownSchema>>(
      `/pages/${encodeURIComponent(pageId)}/markdown`,
      {
        method: "PATCH",
        json: body,
        authContext: { requestContext },
      },
    );
  },
});

export const notionMarkdownTools = {
  notionRetrievePageMarkdownTool,
  notionUpdatePageMarkdownTool,
};
