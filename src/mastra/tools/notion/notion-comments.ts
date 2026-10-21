import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { notionObjectSchema, type NotionObject } from "./notion-shared";
import { notionRequest } from "./notion-auth";

interface CommentListResponse {
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
}

const MAX_FETCH_PAGES = 100;

const richTextInputSchema = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(100)
  .describe("Notion rich text objects");

const displayNameSchema = z.union([
  z.literal("integration"),
  z.literal("user"),
  z.object({
    custom: z.string().min(1).describe("Custom display name"),
  }),
]);

function commentContent(input: {
  content?: string;
  richText?: Record<string, unknown>[];
  markdown?: string;
  markdownVersion?: "v1" | "v2";
}): Record<string, unknown> {
  const modes = [
    input.content !== undefined,
    input.richText !== undefined,
    input.markdown !== undefined,
  ].filter(Boolean).length;

  if (modes !== 1) {
    throw new Error("Provide exactly one of content, richText, or markdown.");
  }

  if (input.content !== undefined) {
    return { rich_text: [{ type: "text", text: { content: input.content } }] };
  }

  if (input.richText !== undefined) {
    if (input.markdownVersion !== undefined) {
      throw new Error("markdownVersion can only be used with markdown.");
    }
    return { rich_text: input.richText };
  }

  return {
    markdown: input.markdown,
    ...(input.markdownVersion !== undefined ? { markdown_version: input.markdownVersion } : {}),
  };
}

function displayNameBody(
  displayName: "integration" | "user" | { custom: string } | undefined,
): Record<string, unknown> | undefined {
  if (displayName === undefined) return undefined;
  if (typeof displayName === "string") return { type: displayName };
  return { type: "custom", custom: { name: displayName.custom } };
}

export const notionCreateCommentTool = createTool({
  id: "notion_create_comment",
  title: "Notion: create comment",
  description:
    "Comment on a page, a block, or an existing discussion thread. Requires insert-comment " +
    "capabilities on the connection (off by default).",
  inputSchema: z
    .object({
      pageId: z.string().optional().describe("Comment on this page"),
      blockId: z.string().optional().describe("Comment on a specific block"),
      discussionId: z.string().optional().describe("Reply to an existing discussion"),
      content: z.string().optional().describe("Plain text comment"),
      richText: richTextInputSchema.optional(),
      markdown: z.string().optional().describe("Comment as inline Markdown"),
      markdownVersion: z
        .enum(["v1", "v2"])
        .optional()
        .describe("Markdown syntax for `markdown`"),
      attachments: z
        .array(
          z.object({
            fileUploadId: z.string().describe("Uploaded file upload ID"),
          }),
        )
        .max(3)
        .optional()
        .describe("Up to three uploaded files to attach"),
      displayName: displayNameSchema
        .optional()
        .describe("Display name for the comment author"),
    })
    .superRefine((value, ctx) => {
      const targets = [value.pageId, value.blockId, value.discussionId].filter(
        (item) => item !== undefined,
      );
      if (targets.length !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "Provide exactly one of pageId, blockId, or discussionId.",
          path: ["pageId"],
        });
      }
      if (value.pageId !== undefined && value.blockId !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "pageId and blockId cannot both be provided.",
          path: ["blockId"],
        });
      }
    }),
  outputSchema: notionObjectSchema,
  execute: async (
    {
      pageId,
      blockId,
      discussionId,
      content,
      richText,
      markdown,
      markdownVersion,
      attachments,
      displayName,
    },
    { requestContext },
  ) => {
    return notionRequest<NotionObject>("/comments", {
      method: "POST",
      json: {
        ...(discussionId !== undefined
          ? { discussion_id: discussionId }
          : {
              parent: pageId !== undefined ? { page_id: pageId } : { block_id: blockId },
            }),
        ...commentContent({ content, richText, markdown, markdownVersion }),
        ...(attachments !== undefined
          ? {
              attachments: attachments.map(
                (attachment: { fileUploadId: string }) => ({
                  type: "file_upload",
                  file_upload_id: attachment.fileUploadId,
                }),
              ),
            }
          : {}),
        ...(displayNameBody(displayName) ? { display_name: displayNameBody(displayName) } : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const notionListCommentsTool = createTool({
  id: "notion_list_comments",
  title: "Notion: list comments",
  description:
    "List unresolved comments on a page or block. Set `fetchAll` to follow pagination.",
  inputSchema: z.object({
    blockId: z.string().describe("Page or block ID"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Comments per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    fetchAll: z.boolean().default(false).describe("Follow pagination and return all comments"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum comments to return across pages"),
  }),
  outputSchema: z.object({
    comments: z.array(notionObjectSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    fetchedAll: z.boolean(),
  }),
  execute: async (
    { blockId, pageSize, startCursor, fetchAll, maxResults },
    { requestContext },
  ) => {
    const fetchPage = async (cursor?: string) =>
      notionRequest<CommentListResponse>("/comments", {
        query: { block_id: blockId, page_size: pageSize, start_cursor: cursor },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        comments: page.results ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        fetchedAll: !page.has_more,
      };
    }

    const comments: NotionObject[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      comments.push(...(page.results ?? []));
      if (maxResults !== undefined && comments.length >= maxResults) {
        return {
          comments: comments.slice(0, maxResults),
          nextCursor: page.next_cursor ?? null,
          hasMore: page.has_more ?? false,
          fetchedAll: false,
        };
      }
      cursor = page.next_cursor ?? undefined;
      hasMore = Boolean(page.has_more);
      pages += 1;
    }

    return {
      comments,
      nextCursor: hasMore ? (cursor ?? null) : null,
      hasMore,
      fetchedAll: !hasMore,
    };
  },
});

export const notionRetrieveCommentTool = createTool({
  id: "notion_retrieve_comment",
  title: "Notion: retrieve comment",
  description: "Retrieve a single comment by ID.",
  inputSchema: z.object({
    commentId: z.string().describe("Comment ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ commentId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/comments/${encodeURIComponent(commentId)}`, {
      authContext: { requestContext },
    });
  },
});

export const notionUpdateCommentTool = createTool({
  id: "notion_update_comment",
  title: "Notion: update comment",
  description:
    "Update a comment this connection created. Provide exactly one of content, richText, or markdown.",
  inputSchema: z.object({
    commentId: z.string().describe("Comment ID"),
    content: z.string().optional().describe("Replacement plain text"),
    richText: richTextInputSchema.optional(),
    markdown: z.string().optional().describe("Replacement inline Markdown"),
    markdownVersion: z.enum(["v1", "v2"]).optional().describe("Markdown syntax for `markdown`"),
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    { commentId, content, richText, markdown, markdownVersion },
    { requestContext },
  ) => {
    return notionRequest<NotionObject>(`/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      json: commentContent({ content, richText, markdown, markdownVersion }),
      authContext: { requestContext },
    });
  },
});

export const notionDeleteCommentTool = createTool({
  id: "notion_delete_comment",
  title: "Notion: delete comment",
  description: "Delete a comment this connection created.",
  inputSchema: z.object({
    commentId: z.string().describe("Comment ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ commentId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });
  },
});

export const notionCommentTools = {
  notionCreateCommentTool,
  notionListCommentsTool,
  notionRetrieveCommentTool,
  notionUpdateCommentTool,
  notionDeleteCommentTool,
};
