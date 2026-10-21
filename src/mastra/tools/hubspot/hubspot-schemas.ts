import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotRecordSchema } from "./hubspot-shared";

export const hubspotListObjectSchemasTool = createTool({
  id: "hubspot_list_object_schemas",
  title: "HubSpot: list object schemas",
  description:
    "List custom object schemas. Use a returned object type ID with the custom object tools.",
  inputSchema: z.object({
    archived: z.boolean().optional().describe("Include archived object schemas"),
  }),
  outputSchema: z.looseObject({
    results: z.array(hubspotRecordSchema),
  }),
  execute: async ({ archived }, { requestContext }) => {
    return hubspotRequest("/crm/v3/schemas", {
      query: { archived },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetObjectSchemaTool = createTool({
  id: "hubspot_get_object_schema",
  title: "HubSpot: get object schema",
  description: "Retrieve one custom object schema, including its properties and associations.",
  inputSchema: z.object({
    objectType: z
      .string()
      .min(1)
      .describe("Custom object type ID (e.g. 2-123456) or fully qualified name"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ objectType }, { requestContext }) => {
    return hubspotRequest(`/crm/v3/schemas/${encodeURIComponent(objectType)}`, {
      authContext: { requestContext },
    });
  },
});

export const hubspotSchemaTools = {
  hubspotListObjectSchemasTool,
  hubspotGetObjectSchemaTool,
};
