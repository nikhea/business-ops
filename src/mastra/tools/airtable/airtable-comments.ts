import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { airtableRequest } from "./airtable-auth";

interface AirtableComment {
  id: string;
  createdTime: string;
  lastUpdatedTime?: string | null;
  text: string;
  parentCommentId?: string;
  author: { id: string; email: string; name?: string };
  mentioned?: Record<string, unknown>;
  attachments?: {
    id: string;
    url: string;
    filename: string;
    type?: string;
    size?: number;
    width?: number;
    height?: number;
  }[];
  reactions?: unknown[];
}

const attachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  type: z.string().optional(),
  size: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const authorSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
});

const commentSchema = z.object({
  id: z.string(),
  createdTime: z.string(),
  lastUpdatedTime: z.string().nullable().optional(),
  text: z.string(),
  parentCommentId: z.string().optional(),
  author: authorSchema,
  mentioned: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(attachmentSchema).optional(),
  reactions: z.array(z.unknown()).optional(),
});

function commentsPath(baseId: string, table: string, recordId: string): string {
  return `/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}/comments`;
}

function mapComment(comment: AirtableComment) {
  return {
    id: comment.id,
    createdTime: comment.createdTime,
    lastUpdatedTime: comment.lastUpdatedTime ?? null,
    text: comment.text,
    parentCommentId: comment.parentCommentId,
    author: comment.author,
    mentioned: comment.mentioned,
    attachments: comment.attachments,
    reactions: comment.reactions,
  };
}

export const airtableListCommentsTool = createTool({
  id: "airtable_list_comments",
  title: "Airtable: list comments",
  description: "List comments on a record, newest first.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordId: z.string().describe("Record ID"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Comments per page (max 100)"),
    offset: z.string().optional().describe("Offset from a previous page"),
  }),
  outputSchema: z.object({
    comments: z.array(commentSchema),
    offset: z.string().nullable().optional(),
  }),
  execute: async ({ baseId, table, recordId, pageSize, offset }, { requestContext }) => {
    const result = await airtableRequest<{
      comments?: AirtableComment[];
      offset?: string | null;
    }>(commentsPath(baseId, table, recordId), {
      query: { pageSize, offset },
      authContext: { requestContext },
    });

    return {
      comments: (result.comments ?? []).map(mapComment),
      offset: result.offset ?? null,
    };
  },
});

export const airtableCreateCommentTool = createTool({
  id: "airtable_create_comment",
  title: "Airtable: create comment",
  description:
    "Comment on a record. Supports Airtable mentions with `@[usr...]` syntax and threaded replies via parentCommentId.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordId: z.string().describe("Record ID"),
    text: z.string().describe("Comment text"),
    parentCommentId: z.string().optional().describe("Parent comment ID for a threaded reply"),
  }),
  outputSchema: commentSchema,
  execute: async ({ baseId, table, recordId, text, parentCommentId }, { requestContext }) => {
    const comment = await airtableRequest<AirtableComment>(commentsPath(baseId, table, recordId), {
      method: "POST",
      json: { text, parentCommentId },
      authContext: { requestContext },
    });

    return mapComment(comment);
  },
});

export const airtableUpdateCommentTool = createTool({
  id: "airtable_update_comment",
  title: "Airtable: update comment",
  description: "Edit a comment. API users can only edit comments they created.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordId: z.string().describe("Record ID"),
    commentId: z.string().describe("Comment ID"),
    text: z.string().describe("New comment text"),
  }),
  outputSchema: commentSchema,
  execute: async ({ baseId, table, recordId, commentId, text }, { requestContext }) => {
    const comment = await airtableRequest<AirtableComment>(
      `${commentsPath(baseId, table, recordId)}/${encodeURIComponent(commentId)}`,
      {
        method: "PATCH",
        json: { text },
        authContext: { requestContext },
      },
    );

    return mapComment(comment);
  },
});

export const airtableDeleteCommentTool = createTool({
  id: "airtable_delete_comment",
  title: "Airtable: delete comment",
  description:
    "Delete a comment. Non-admin API users can only delete their own comments; Enterprise Admins can delete any.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordId: z.string().describe("Record ID"),
    commentId: z.string().describe("Comment ID"),
  }),
  outputSchema: z.object({
    id: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ baseId, table, recordId, commentId }, { requestContext }) => {
    return airtableRequest<{ id: string; deleted: boolean }>(
      `${commentsPath(baseId, table, recordId)}/${encodeURIComponent(commentId)}`,
      {
        method: "DELETE",
        authContext: { requestContext },
      },
    );
  },
});

export const airtableCommentTools = {
  airtableListCommentsTool,
  airtableCreateCommentTool,
  airtableUpdateCommentTool,
  airtableDeleteCommentTool,
};
