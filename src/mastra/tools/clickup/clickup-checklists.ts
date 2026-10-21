import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const checklistItemSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  orderindex: z.union([z.number(), z.string()]).nullable().optional(),
  assignee: z.unknown().nullable().optional(),
  resolved: z.boolean().optional(),
  parent: z.string().nullable().optional(),
  date_created: z.string().optional(),
  children: z.array(z.unknown()).optional(),
});

const checklistSchema = z.looseObject({
  id: z.string(),
  task_id: z.string().optional(),
  name: z.string().optional(),
  date_created: z.string().optional(),
  orderindex: z.union([z.number(), z.string()]).nullable().optional(),
  resolved: z.union([z.number(), z.string()]).optional(),
  unresolved: z.union([z.number(), z.string()]).optional(),
  items: z.array(checklistItemSchema).optional(),
});

function taskLookupQuery(customTaskIds?: boolean, teamId?: string) {
  return {
    ...(customTaskIds ? { custom_task_ids: true } : {}),
    ...(teamId ? { team_id: teamId } : {}),
  };
}

export const clickupCreateChecklistTool = createTool({
  id: "clickup_create_checklist",
  title: "ClickUp: create checklist",
  description: "Add a checklist to a ClickUp task.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    name: z.string().describe("Checklist name"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({ checklist: checklistSchema }),
  execute: async ({ taskId, name, customTaskIds, teamId }, { requestContext }) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<{ checklist: z.infer<typeof checklistSchema> }>(
      `/task/${encodeURIComponent(taskId)}/checklist`,
      {
        method: "POST",
        query: taskLookupQuery(customTaskIds, teamId),
        json: { name },
        authContext: { requestContext },
      },
    );
  },
});

export const clickupEditChecklistTool = createTool({
  id: "clickup_edit_checklist",
  title: "ClickUp: edit checklist",
  description: "Rename or reorder a ClickUp task checklist.",
  inputSchema: z.object({
    checklistId: z.string().describe("Checklist ID"),
    name: z.string().optional().describe("New checklist name"),
    position: z.number().int().min(0).optional().describe("Order position; 0 is top"),
  }),
  outputSchema: z.object({ checklistId: z.string(), updated: z.boolean() }),
  execute: async ({ checklistId, name, position }, { requestContext }) => {
    if (name === undefined && position === undefined) {
      throw new Error("Provide name or position to update the checklist.");
    }

    await clickupRequest(`/checklist/${encodeURIComponent(checklistId)}`, {
      method: "PUT",
      json: {
        ...(name !== undefined ? { name } : {}),
        ...(position !== undefined ? { position } : {}),
      },
      authContext: { requestContext },
    });

    return { checklistId, updated: true };
  },
});

export const clickupDeleteChecklistTool = createTool({
  id: "clickup_delete_checklist",
  title: "ClickUp: delete checklist",
  description: "Delete a checklist (and its items) from a ClickUp task.",
  inputSchema: z.object({
    checklistId: z.string().describe("Checklist ID"),
  }),
  outputSchema: z.object({ checklistId: z.string(), deleted: z.boolean() }),
  execute: async ({ checklistId }, { requestContext }) => {
    await clickupRequest(`/checklist/${encodeURIComponent(checklistId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { checklistId, deleted: true };
  },
});

export const clickupCreateChecklistItemTool = createTool({
  id: "clickup_create_checklist_item",
  title: "ClickUp: create checklist item",
  description: "Add an item to a ClickUp task checklist.",
  inputSchema: z.object({
    checklistId: z.string().describe("Checklist ID"),
    name: z.string().describe("Item name"),
    assignee: z.number().int().optional().describe("Assignee user ID"),
  }),
  outputSchema: z.object({ checklist: checklistSchema }),
  execute: async ({ checklistId, name, assignee }, { requestContext }) => {
    const result = await clickupRequest<Record<string, unknown>>(
      `/checklist/${encodeURIComponent(checklistId)}/checklist_item`,
      {
        method: "POST",
        json: {
          name,
          ...(assignee !== undefined ? { assignee } : {}),
        },
        authContext: { requestContext },
      },
    );

    const checklist = (result.checklist ?? result) as z.infer<typeof checklistSchema>;
    return { checklist };
  },
});

export const clickupEditChecklistItemTool = createTool({
  id: "clickup_edit_checklist_item",
  title: "ClickUp: edit checklist item",
  description:
    "Rename a checklist item, set its assignee, mark it resolved, or nest it under another item.",
  inputSchema: z.object({
    checklistId: z.string().describe("Checklist ID"),
    checklistItemId: z.string().describe("Checklist item ID"),
    name: z.string().optional().describe("New item name"),
    assignee: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .describe("Assignee user ID, or null to unassign"),
    resolved: z.boolean().optional().describe("Mark the item resolved or unresolved"),
    parent: z
      .string()
      .nullable()
      .optional()
      .describe("Parent checklist item ID to nest under, or null to unnested"),
  }),
  outputSchema: z.object({ checklist: checklistSchema }),
  execute: async (
    { checklistId, checklistItemId, name, assignee, resolved, parent },
    { requestContext },
  ) => {
    if (
      name === undefined &&
      assignee === undefined &&
      resolved === undefined &&
      parent === undefined
    ) {
      throw new Error("Provide at least one field to update.");
    }

    return clickupRequest<Record<string, unknown>>(
      `/checklist/${encodeURIComponent(checklistId)}/checklist_item/${encodeURIComponent(checklistItemId)}`,
      {
        method: "PUT",
        json: {
          ...(name !== undefined ? { name } : {}),
          ...(assignee !== undefined ? { assignee } : {}),
          ...(resolved !== undefined ? { resolved } : {}),
          ...(parent !== undefined ? { parent } : {}),
        },
        authContext: { requestContext },
      },
    ).then((result) => ({
      checklist: (result.checklist ?? result) as z.infer<typeof checklistSchema>,
    }));
  },
});

export const clickupDeleteChecklistItemTool = createTool({
  id: "clickup_delete_checklist_item",
  title: "ClickUp: delete checklist item",
  description: "Delete an item from a ClickUp task checklist.",
  inputSchema: z.object({
    checklistId: z.string().describe("Checklist ID"),
    checklistItemId: z.string().describe("Checklist item ID"),
  }),
  outputSchema: z.object({
    checklistId: z.string(),
    checklistItemId: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ checklistId, checklistItemId }, { requestContext }) => {
    await clickupRequest(
      `/checklist/${encodeURIComponent(checklistId)}/checklist_item/${encodeURIComponent(checklistItemId)}`,
      {
        method: "DELETE",
        authContext: { requestContext },
      },
    );

    return { checklistId, checklistItemId, deleted: true };
  },
});

export const clickupChecklistTools = {
  clickupCreateChecklistTool,
  clickupEditChecklistTool,
  clickupDeleteChecklistTool,
  clickupCreateChecklistItemTool,
  clickupEditChecklistItemTool,
  clickupDeleteChecklistItemTool,
};
