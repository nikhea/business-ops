import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const webhookSchema = z.looseObject({
  id: z.string(),
  userid: z.number().optional(),
  team_id: z.union([z.number(), z.string()]).optional(),
  endpoint: z.string().optional(),
  client_id: z.string().optional(),
  events: z.array(z.string()).optional(),
  task_id: z.union([z.string(), z.number()]).nullable().optional(),
  list_id: z.union([z.string(), z.number()]).nullable().optional(),
  folder_id: z.union([z.string(), z.number()]).nullable().optional(),
  space_id: z.union([z.string(), z.number()]).nullable().optional(),
  health: z.unknown().optional(),
  secret: z.string().optional(),
});

const webhookResponseSchema = z.object({
  id: z.string(),
  webhook: webhookSchema,
});

export const clickupListWebhooksTool = createTool({
  id: "clickup_list_webhooks",
  title: "ClickUp: list webhooks",
  description:
    "List the webhooks created via the API by the authenticated user for a Workspace.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
  }),
  outputSchema: z.object({
    webhooks: z.array(webhookSchema),
  }),
  execute: async ({ teamId }, { requestContext }) => {
    return clickupRequest<{ webhooks?: z.infer<typeof webhookSchema>[] }>(
      `/team/${encodeURIComponent(teamId)}/webhook`,
      { authContext: { requestContext } },
    ).then((result) => ({ webhooks: result.webhooks ?? [] }));
  },
});

export const clickupCreateWebhookTool = createTool({
  id: "clickup_create_webhook",
  title: "ClickUp: create webhook",
  description:
    "Create a ClickUp webhook. Subscribe to specific events or `*` for all. Optionally scope it to one Space, Folder, List, or task.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
    endpoint: z.string().url().describe("HTTPS endpoint that receives webhook POSTs"),
    events: z
      .array(z.string())
      .min(1)
      .default(["*"])
      .describe("Event names, e.g. taskCreated, taskUpdated, or *"),
    spaceId: z.string().optional().describe("Scope to a Space"),
    folderId: z.string().optional().describe("Scope to a Folder"),
    listId: z.string().optional().describe("Scope to a List"),
    taskId: z.string().optional().describe("Scope to a task"),
  }),
  outputSchema: webhookResponseSchema,
  execute: async (
    { teamId, endpoint, events, spaceId, folderId, listId, taskId },
    { requestContext },
  ) => {
    const scopes = [spaceId, folderId, listId, taskId].filter(Boolean);
    if (scopes.length > 1) {
      throw new Error("Only one of spaceId, folderId, listId, or taskId may be provided.");
    }

    return clickupRequest<z.infer<typeof webhookResponseSchema>>(
      `/team/${encodeURIComponent(teamId)}/webhook`,
      {
        method: "POST",
        json: {
          endpoint,
          events,
          ...(spaceId ? { space_id: Number(spaceId) } : {}),
          ...(folderId ? { folder_id: Number(folderId) } : {}),
          ...(listId ? { list_id: Number(listId) } : {}),
          ...(taskId ? { task_id: taskId } : {}),
        },
        authContext: { requestContext },
      },
    ).then((result) => {
      const hook = (result.webhook ?? result) as z.infer<typeof webhookSchema>;
      const id = result.id ?? hook.id;
      if (!id) throw new Error("ClickUp did not return a webhook ID.");
      return { id, webhook: { ...hook, id: hook.id ?? id } };
    });
  },
});

export const clickupUpdateWebhookTool = createTool({
  id: "clickup_update_webhook",
  title: "ClickUp: update webhook",
  description: "Update a ClickUp webhook's endpoint, events, or active status.",
  inputSchema: z.object({
    webhookId: z.string().describe("Webhook ID"),
    endpoint: z.string().url().describe("HTTPS endpoint that receives webhook POSTs"),
    events: z.array(z.string()).min(1).describe("Event names"),
    status: z.enum(["active", "inactive"]).describe("Enable or disable the webhook"),
  }),
  outputSchema: webhookResponseSchema,
  execute: async ({ webhookId, endpoint, events, status }, { requestContext }) => {
    return clickupRequest<z.infer<typeof webhookResponseSchema>>(
      `/webhook/${encodeURIComponent(webhookId)}`,
      {
        method: "PUT",
        json: { endpoint, events, status },
        authContext: { requestContext },
      },
    ).then((result) => {
      const hook = (result.webhook ?? result) as z.infer<typeof webhookSchema>;
      const id = result.id ?? hook.id ?? webhookId;
      return { id, webhook: { ...hook, id: hook.id ?? id } };
    });
  },
});

export const clickupDeleteWebhookTool = createTool({
  id: "clickup_delete_webhook",
  title: "ClickUp: delete webhook",
  description: "Delete a ClickUp webhook.",
  inputSchema: z.object({
    webhookId: z.string().describe("Webhook ID"),
  }),
  outputSchema: z.object({
    webhookId: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ webhookId }, { requestContext }) => {
    await clickupRequest(`/webhook/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { webhookId, deleted: true };
  },
});

export const clickupWebhookTools = {
  clickupListWebhooksTool,
  clickupCreateWebhookTool,
  clickupUpdateWebhookTool,
  clickupDeleteWebhookTool,
};
