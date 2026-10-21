import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { airtableRequest } from "./airtable-auth";

interface AirtableWebhook {
  id: string;
  areNotificationsEnabled?: boolean;
  cursorForNextPayload?: number;
  isHookEnabled?: boolean;
  notificationUrl?: string | null;
  expirationTime?: string | null;
  lastSuccessfulNotificationTime?: string | null;
  specification?: unknown;
  lastNotificationResult?: unknown;
}

interface WebhookFilters {
  dataTypes?: string[];
  recordChangeScope?: string;
  watchDataInFieldIds?: string[];
  includeCellValuesInFieldIds?: "all" | string[];
  includePreviousCellValues?: boolean;
}

const webhookSchema = z.object({
  id: z.string(),
  areNotificationsEnabled: z.boolean().optional(),
  cursorForNextPayload: z.number().optional(),
  isHookEnabled: z.boolean().optional(),
  notificationUrl: z.string().nullable().optional(),
  expirationTime: z.string().nullable().optional(),
  lastSuccessfulNotificationTime: z.string().nullable().optional(),
  specification: z.unknown().optional(),
  lastNotificationResult: z.unknown().nullable().optional(),
});

function webhooksPath(baseId: string): string {
  return `/bases/${encodeURIComponent(baseId)}/webhooks`;
}

function webhookPath(baseId: string, webhookId: string): string {
  return `${webhooksPath(baseId)}/${encodeURIComponent(webhookId)}`;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  ) as Partial<T>;
}

export const airtableListWebhooksTool = createTool({
  id: "airtable_list_webhooks",
  title: "Airtable: list webhooks",
  description:
    "List the webhooks registered on a base, including enabled state, expiration, notification URL, and last delivery result.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
  }),
  outputSchema: z.object({
    webhooks: z.array(webhookSchema),
  }),
  execute: async ({ baseId }, { requestContext }) => {
    const result = await airtableRequest<{ webhooks?: AirtableWebhook[] }>(webhooksPath(baseId), {
      authContext: { requestContext },
    });

    return {
      webhooks: result.webhooks ?? [],
    };
  },
});

export const airtableCreateWebhookTool = createTool({
  id: "airtable_create_webhook",
  title: "Airtable: create webhook",
  description:
    "Create a webhook on a base (requires creator permissions and webhook:manage). Webhooks expire after 7 days; refresh them or list payloads to extend. Save the returned macSecretBase64 for ping verification.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    notificationUrl: z.string().url().optional().describe("URL that receives webhook pings"),
    dataTypes: z
      .array(z.string())
      .min(1)
      .default(["tableData"])
      .describe('Change types to watch, e.g. ["tableData"]'),
    recordChangeScope: z.string().optional().describe("Limit record changes to this table ID"),
    watchDataInFieldIds: z
      .array(z.string())
      .optional()
      .describe("Only notify when these fields change"),
    includeCellValuesInFieldIds: z
      .union([z.literal("all"), z.array(z.string())])
      .optional()
      .describe('Include cell values in payloads: "all" or field IDs'),
    includePreviousCellValues: z
      .boolean()
      .optional()
      .describe("Include previous cell values in change payloads"),
  }),
  outputSchema: z.object({
    id: z.string(),
    macSecretBase64: z.string(),
    expirationTime: z.string().nullable().optional(),
  }),
  execute: async (
    {
      baseId,
      notificationUrl,
      dataTypes,
      recordChangeScope,
      watchDataInFieldIds,
      includeCellValuesInFieldIds,
      includePreviousCellValues,
    },
    { requestContext },
  ) => {
    const filters: WebhookFilters = compact({
      dataTypes,
      recordChangeScope,
      watchDataInFieldIds,
      includeCellValuesInFieldIds,
      includePreviousCellValues,
    });

    const result = await airtableRequest<{
      id: string;
      macSecretBase64: string;
      expirationTime?: string | null;
    }>(webhooksPath(baseId), {
      method: "POST",
      json: {
        notificationUrl,
        specification: { options: { filters } },
      },
      authContext: { requestContext },
    });

    return result;
  },
});

export const airtableDeleteWebhookTool = createTool({
  id: "airtable_delete_webhook",
  title: "Airtable: delete webhook",
  description: "Delete a webhook from a base.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    webhookId: z.string().describe("Webhook ID"),
  }),
  outputSchema: z.object({
    webhookId: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ baseId, webhookId }, { requestContext }) => {
    await airtableRequest(webhookPath(baseId, webhookId), {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { webhookId, deleted: true };
  },
});

export const airtableRefreshWebhookTool = createTool({
  id: "airtable_refresh_webhook",
  title: "Airtable: refresh webhook",
  description: "Extend an active webhook's expiration by 7 days.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    webhookId: z.string().describe("Webhook ID"),
  }),
  outputSchema: z.object({
    expirationTime: z.string().nullable().optional(),
  }),
  execute: async ({ baseId, webhookId }, { requestContext }) => {
    return airtableRequest<{ expirationTime?: string | null }>(
      `${webhookPath(baseId, webhookId)}/refresh`,
      {
        method: "POST",
        authContext: { requestContext },
      },
    );
  },
});

export const airtableListWebhookPayloadsTool = createTool({
  id: "airtable_list_webhook_payloads",
  title: "Airtable: list webhook payloads",
  description:
    "Poll a webhook for change payloads. Save the returned cursor and pass it next time. Calling this also extends the webhook's life. Max 50 payloads per request.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    webhookId: z.string().describe("Webhook ID"),
    cursor: z.number().int().min(1).optional().describe("Cursor returned by the previous poll"),
    limit: z.number().int().min(1).max(50).optional().describe("Maximum payloads (max 50)"),
  }),
  outputSchema: z.object({
    cursor: z.number(),
    mightHaveMore: z.boolean(),
    payloads: z.array(z.unknown()),
  }),
  execute: async ({ baseId, webhookId, cursor, limit }, { requestContext }) => {
    return airtableRequest<{
      cursor: number;
      mightHaveMore: boolean;
      payloads?: unknown[];
    }>(`${webhookPath(baseId, webhookId)}/payloads`, {
      query: { cursor, limit },
      authContext: { requestContext },
    }).then((result) => ({
      cursor: result.cursor,
      mightHaveMore: result.mightHaveMore,
      payloads: result.payloads ?? [],
    }));
  },
});

export const airtableWebhookTools = {
  airtableListWebhooksTool,
  airtableCreateWebhookTool,
  airtableDeleteWebhookTool,
  airtableRefreshWebhookTool,
  airtableListWebhookPayloadsTool,
};
