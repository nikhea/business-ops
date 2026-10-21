import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendMutationSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const webhookEventSchema = z.enum([
  "email.sent",
  "email.scheduled",
  "email.delivered",
  "email.delivery_delayed",
  "email.complained",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.received",
  "email.failed",
  "email.suppressed",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "contact.topics.updated",
  "domain.created",
  "domain.updated",
  "domain.deleted",
  "suppression.added",
  "suppression.removed",
  "topic.created",
  "topic.updated",
  "topic.deleted",
  "inbox.created",
  "inbox.updated",
  "inbox.deleted",
  "inbox.thread.created",
  "inbox.thread.folder.updated",
  "inbox.thread.assigned",
  "inbox.thread.unassigned",
  "inbox.thread.labels.updated",
  "inbox.email.received",
  "inbox.email.sent",
  "inbox.draft.created",
  "inbox.draft.updated",
  "inbox.draft.sent",
  "inbox.draft.deleted",
]);

export const resendCreateWebhookTool = createTool({
  id: "resend_create_webhook",
  title: "Resend: create webhook",
  description:
    "Create a webhook endpoint. The response includes the signing secret used to verify deliveries.",
  inputSchema: z.object({
    endpoint: z.string().url().describe("HTTPS endpoint that receives webhook deliveries"),
    events: z.array(webhookEventSchema).min(1).describe("Event types to subscribe to"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ endpoint, events }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.webhooks.create({ endpoint, events }));
  },
});

export const resendListWebhooksTool = createTool({
  id: "resend_list_webhooks",
  title: "Resend: list webhooks",
  description: "List webhook endpoints with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.webhooks.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetWebhookTool = createTool({
  id: "resend_get_webhook",
  title: "Resend: get webhook",
  description: "Retrieve a webhook endpoint and its subscribed event types.",
  inputSchema: z.object({
    webhookId: z.string().describe("Webhook ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ webhookId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.webhooks.get(webhookId));
  },
});

export const resendUpdateWebhookTool = createTool({
  id: "resend_update_webhook",
  title: "Resend: update webhook",
  description: "Update a webhook endpoint, event subscription, or enabled status.",
  inputSchema: z.object({
    webhookId: z.string().describe("Webhook ID"),
    endpoint: z.string().url().optional().describe("New HTTPS endpoint"),
    events: z.array(webhookEventSchema).min(1).optional().describe("Replacement event list"),
    status: z.enum(["enabled", "disabled"]).optional().describe("Enable or disable deliveries"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ webhookId, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.webhooks.update(webhookId, input));
  },
});

export const resendDeleteWebhookTool = createTool({
  id: "resend_delete_webhook",
  title: "Resend: delete webhook",
  description: "Delete a webhook endpoint.",
  inputSchema: z.object({
    webhookId: z.string().describe("Webhook ID"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ webhookId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.webhooks.remove(webhookId));
  },
});

export const resendWebhookTools = {
  resendCreateWebhookTool,
  resendListWebhooksTool,
  resendGetWebhookTool,
  resendUpdateWebhookTool,
  resendDeleteWebhookTool,
};
