import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const commentSchema = z.looseObject({
  id: z.string(),
  comment: z.array(z.unknown()).optional(),
  comment_text: z.string(),
  user: z.unknown().optional(),
  resolved: z.boolean().optional(),
  assignee: z.unknown().nullable().optional(),
  assigned_by: z.unknown().nullable().optional(),
  reactions: z.array(z.unknown()).optional(),
  date: z.string().optional(),
  reply_count: z.union([z.string(), z.number()]).optional(),
});

const createdCommentSchema = z.looseObject({
  id: z.string(),
  hist_id: z.string().optional(),
  date: z.union([z.string(), z.number()]).optional(),
});

function taskLookupQuery(customTaskIds?: boolean, teamId?: string) {
  return {
    ...(customTaskIds ? { custom_task_ids: true } : {}),
    ...(teamId ? { team_id: teamId } : {}),
  };
}

export const clickupListTaskCommentsTool = createTool({
  id: "clickup_list_task_comments",
  title: "ClickUp: list task comments",
  description:
    "List comments on a ClickUp task, newest first. Returns the 25 most recent comments by default; pass `start` and `startId` together to page older comments.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    start: z.number().int().optional().describe("Unix ms timestamp from the last comment on the page"),
    startId: z.string().optional().describe("Comment ID from the last comment on the page"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({
    comments: z.array(commentSchema),
  }),
  execute: async (
    { taskId, start, startId, customTaskIds, teamId },
    { requestContext },
  ) => {
    if ((start === undefined) !== (startId === undefined)) {
      throw new Error("start and startId must be provided together.");
    }
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<{ comments?: z.infer<typeof commentSchema>[] }>(
      `/task/${encodeURIComponent(taskId)}/comment`,
      {
        query: {
          ...taskLookupQuery(customTaskIds, teamId),
          start,
          start_id: startId,
        },
        authContext: { requestContext },
      },
    ).then((result) => ({ comments: result.comments ?? [] }));
  },
});

export const clickupCreateTaskCommentTool = createTool({
  id: "clickup_create_task_comment",
  title: "ClickUp: create task comment",
  description:
    "Add a comment to a ClickUp task. Optionally assign the comment to a user or group and notify the task creator.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    commentText: z.string().describe("Comment text"),
    notifyAll: z.boolean().default(false).describe("Also notify the comment creator"),
    assignee: z.number().int().optional().describe("Assignee user ID"),
    groupAssignee: z.string().optional().describe("Assignee group ID"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: createdCommentSchema,
  execute: async (
    { taskId, commentText, notifyAll, assignee, groupAssignee, customTaskIds, teamId },
    { requestContext },
  ) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<z.infer<typeof createdCommentSchema>>(
      `/task/${encodeURIComponent(taskId)}/comment`,
      {
        method: "POST",
        query: taskLookupQuery(customTaskIds, teamId),
        json: {
          comment_text: commentText,
          notify_all: notifyAll,
          ...(assignee !== undefined ? { assignee } : {}),
          ...(groupAssignee !== undefined ? { group_assignee: groupAssignee } : {}),
        },
        authContext: { requestContext },
      },
    );
  },
});

export const clickupUpdateCommentTool = createTool({
  id: "clickup_update_comment",
  title: "ClickUp: update comment",
  description:
    "Replace a ClickUp comment's text, optionally reassign it, or mark it resolved/unresolved.",
  inputSchema: z.object({
    commentId: z.string().describe("Comment ID"),
    commentText: z.string().describe("New comment text"),
    assignee: z.number().int().nullable().optional().describe("Assignee user ID, or null"),
    groupAssignee: z.string().nullable().optional().describe("Assignee group ID, or null"),
    resolved: z.boolean().default(false).describe("Mark the comment resolved"),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async (
    { commentId, commentText, assignee, groupAssignee, resolved },
    { requestContext },
  ) => {
    await clickupRequest(`/comment/${encodeURIComponent(commentId)}`, {
      method: "PUT",
      json: {
        comment_text: commentText,
        assignee: assignee ?? null,
        resolved,
        ...(groupAssignee !== undefined ? { group_assignee: groupAssignee } : {}),
      },
      authContext: { requestContext },
    });

    return { success: true };
  },
});

export const clickupDeleteCommentTool = createTool({
  id: "clickup_delete_comment",
  title: "ClickUp: delete comment",
  description: "Delete a ClickUp task comment.",
  inputSchema: z.object({
    commentId: z.string().describe("Comment ID"),
  }),
  outputSchema: z.object({
    commentId: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ commentId }, { requestContext }) => {
    await clickupRequest(`/comment/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { commentId, deleted: true };
  },
});

export const clickupCommentTools = {
  clickupListTaskCommentsTool,
  clickupCreateTaskCommentTool,
  clickupUpdateCommentTool,
  clickupDeleteCommentTool,
};
