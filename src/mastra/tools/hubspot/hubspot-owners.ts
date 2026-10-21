import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotListSchema, hubspotRecordSchema } from "./hubspot-shared";

export const hubspotListOwnersTool = createTool({
  id: "hubspot_list_owners",
  title: "HubSpot: list owners",
  description:
    "List HubSpot owners (users who can be assigned records) with optional email filtering.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
    email: z.string().email().optional().describe("Only return the owner with this email"),
    archived: z.boolean().optional().describe("Include archived owners"),
  }),
  outputSchema: hubspotListSchema,
  execute: async ({ limit, after, email, archived }, { requestContext }) => {
    return hubspotRequest("/crm/v3/owners", {
      query: { limit, after, email, archived },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetOwnerTool = createTool({
  id: "hubspot_get_owner",
  title: "HubSpot: get owner",
  description: "Retrieve one HubSpot owner by owner ID.",
  inputSchema: z.object({
    ownerId: z.string().min(1).describe("HubSpot owner ID"),
    idProperty: z
      .string()
      .optional()
      .describe("Unique property to use instead of the owner ID, e.g. email"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ ownerId, idProperty }, { requestContext }) => {
    return hubspotRequest(`/crm/v3/owners/${encodeURIComponent(ownerId)}`, {
      query: { idProperty },
      authContext: { requestContext },
    });
  },
});

export const hubspotOwnerTools = {
  hubspotListOwnersTool,
  hubspotGetOwnerTool,
};
