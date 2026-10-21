import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotRecordListSchema, hubspotRecordSchema } from "./hubspot-shared";

const objectIdSchema = z.string().min(1).describe("Marketing event record ID");

const eventPropertiesSchema = z.object({
  eventName: z.string().optional().describe("Event title"),
  eventType: z.string().optional().describe("Event type, e.g. WEBINAR"),
  eventOrganizer: z.string().optional().describe("Event organizer"),
  eventDescription: z.string().optional().describe("Event description"),
  eventUrl: z.string().url().optional().describe("Event registration URL"),
  eventCancelled: z.boolean().optional().describe("Whether the event is cancelled"),
  eventCompleted: z.boolean().optional().describe("Whether the event is complete"),
  startDateTime: z.string().optional().describe("ISO 8601 start time"),
  endDateTime: z.string().optional().describe("ISO 8601 end time"),
  customProperties: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe("Custom event properties"),
});

export const hubspotListMarketingEventsTool = createTool({
  id: "hubspot_list_marketing_events",
  title: "HubSpot: list marketing events",
  description: "List marketing events with cursor pagination.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ limit, after }, { requestContext }) => {
    return hubspotRequest("/marketing/v3/marketing-events", {
      query: { limit, after },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetMarketingEventTool = createTool({
  id: "hubspot_get_marketing_event",
  title: "HubSpot: get marketing event",
  description: "Retrieve one marketing event by record ID.",
  inputSchema: z.object({
    objectId: objectIdSchema,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ objectId }, { requestContext }) => {
    return hubspotRequest(
      `/marketing/v3/marketing-events/${encodeURIComponent(objectId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const hubspotCreateMarketingEventTool = createTool({
  id: "hubspot_create_marketing_event",
  title: "HubSpot: create marketing event",
  description:
    "Create a marketing event. External account and event IDs identify the event in your system.",
  inputSchema: z.object({
    externalAccountId: z.string().min(1).describe("Account ID in your system"),
    externalEventId: z.string().min(1).describe("Event ID in your system"),
    eventName: z.string().min(1).describe("Event title"),
    eventOrganizer: z.string().min(1).describe("Event organizer"),
  })
    .merge(eventPropertiesSchema)
    .extend({
      eventName: z.string().min(1).describe("Event title"),
      eventOrganizer: z.string().min(1).describe("Event organizer"),
    }),
  outputSchema: hubspotRecordSchema,
  execute: async (input, { requestContext }) => {
    return hubspotRequest("/marketing/v3/marketing-events/events", {
      method: "POST",
      json: input,
      authContext: { requestContext },
    });
  },
});

export const hubspotUpdateMarketingEventTool = createTool({
  id: "hubspot_update_marketing_event",
  title: "HubSpot: update marketing event",
  description: "Update marketing event properties by record ID.",
  inputSchema: z.object({
    objectId: objectIdSchema,
  }).merge(eventPropertiesSchema),
  outputSchema: hubspotRecordSchema,
  execute: async ({ objectId, ...properties }, { requestContext }) => {
    if (Object.keys(properties).length === 0) {
      throw new Error("Provide at least one event property.");
    }

    return hubspotRequest(
      `/marketing/v3/marketing-events/${encodeURIComponent(objectId)}`,
      {
        method: "PATCH",
        json: properties,
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotDeleteMarketingEventTool = createTool({
  id: "hubspot_delete_marketing_event",
  title: "HubSpot: delete marketing event",
  description: "Delete a marketing event by record ID.",
  inputSchema: z.object({
    objectId: objectIdSchema,
  }),
  outputSchema: z.object({
    deleted: z.literal(true),
    objectId: z.string(),
  }),
  execute: async ({ objectId }, { requestContext }) => {
    await hubspotRequest(
      `/marketing/v3/marketing-events/${encodeURIComponent(objectId)}`,
      {
        method: "DELETE",
        authContext: { requestContext },
      },
    );

    return { deleted: true as const, objectId };
  },
});

export const hubspotMarketingEventTools = {
  hubspotListMarketingEventsTool,
  hubspotGetMarketingEventTool,
  hubspotCreateMarketingEventTool,
  hubspotUpdateMarketingEventTool,
  hubspotDeleteMarketingEventTool,
};
