import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotRecordListSchema, hubspotRecordSchema } from "./hubspot-shared";

const objectTypeSchema = z
  .string()
  .min(1)
  .describe("Object type, e.g. contacts, companies, deals, tickets, or a custom object type ID");

export const hubspotListPropertiesTool = createTool({
  id: "hubspot_list_properties",
  title: "HubSpot: list properties",
  description:
    "List the property definitions for an object type. Use this to discover internal property names " +
    "and allowed values before creating or updating records.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
    archived: z.boolean().optional().describe("Include archived properties"),
    dataSensitivity: z
      .enum(["non_sensitive", "sensitive", "highly_sensitive"])
      .optional()
      .describe("Filter by data sensitivity"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ objectType, archived, dataSensitivity }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/properties/${encodeURIComponent(objectType)}`,
      {
        query: { archived, dataSensitivity },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotGetPropertyTool = createTool({
  id: "hubspot_get_property",
  title: "HubSpot: get property",
  description: "Retrieve one property definition by internal property name.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
    propertyName: z.string().min(1).describe("Internal property name, e.g. email"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ objectType, propertyName }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/properties/${encodeURIComponent(objectType)}/${encodeURIComponent(propertyName)}`,
      { authContext: { requestContext } },
    );
  },
});

export const hubspotListPropertyGroupsTool = createTool({
  id: "hubspot_list_property_groups",
  title: "HubSpot: list property groups",
  description: "List the property groups for an object type.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ objectType }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/properties/${encodeURIComponent(objectType)}/groups`,
      { authContext: { requestContext } },
    );
  },
});

export const hubspotPropertyTools = {
  hubspotListPropertiesTool,
  hubspotGetPropertyTool,
  hubspotListPropertyGroupsTool,
};
