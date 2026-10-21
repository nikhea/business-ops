import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import {
  getQuery,
  hubspotAssociationInputSchema,
  hubspotListSchema,
  hubspotObjectGetSchema,
  hubspotObjectListSchema,
  hubspotObjectSchema,
  hubspotPropertiesSchema,
  hubspotSearchSchema,
  listQuery,
  objectPath,
  searchBody,
} from "./hubspot-shared";

const customObjectTypeSchema = z
  .string()
  .min(1)
  .describe("Custom object type ID (e.g. 2-123456) or fully qualified name");

export const hubspotListCustomObjectsTool = createTool({
  id: "hubspot_list_custom_objects",
  title: "HubSpot: list custom objects",
  description:
    "List records for a custom object type with property selection and cursor pagination.",
  inputSchema: hubspotObjectListSchema.extend({
    objectType: customObjectTypeSchema,
  }),
  outputSchema: hubspotListSchema,
  execute: async ({ objectType, ...input }, { requestContext }) => {
    return hubspotRequest(objectPath(objectType), {
      query: listQuery(input),
      authContext: { requestContext },
    });
  },
});

export const hubspotSearchCustomObjectsTool = createTool({
  id: "hubspot_search_custom_objects",
  title: "HubSpot: search custom objects",
  description: "Search records for a custom object type using HubSpot CRM filters and sorts.",
  inputSchema: hubspotSearchSchema.extend({
    objectType: customObjectTypeSchema,
  }),
  outputSchema: hubspotListSchema,
  execute: async ({ objectType, ...input }, { requestContext }) => {
    return hubspotRequest(`${objectPath(objectType)}/search`, {
      method: "POST",
      json: searchBody(input),
      authContext: { requestContext },
    });
  },
});

export const hubspotGetCustomObjectTool = createTool({
  id: "hubspot_get_custom_object",
  title: "HubSpot: get custom object",
  description: "Retrieve one custom object record by record ID.",
  inputSchema: hubspotObjectGetSchema.extend({
    objectType: customObjectTypeSchema,
  }),
  outputSchema: hubspotObjectSchema,
  execute: async ({ objectType, objectId, ...input }, { requestContext }) => {
    return hubspotRequest(objectPath(objectType, objectId), {
      query: getQuery(input),
      authContext: { requestContext },
    });
  },
});

export const hubspotCreateCustomObjectTool = createTool({
  id: "hubspot_create_custom_object",
  title: "HubSpot: create custom object",
  description: "Create a record for a custom object type with properties and optional associations.",
  inputSchema: z.object({
    objectType: customObjectTypeSchema,
    properties: hubspotPropertiesSchema,
    associations: z
      .array(hubspotAssociationInputSchema)
      .optional()
      .describe("Associations to create with the record"),
  }),
  outputSchema: hubspotObjectSchema,
  execute: async ({ objectType, properties, associations }, { requestContext }) => {
    if (Object.keys(properties).length === 0) {
      throw new Error("Provide at least one property.");
    }

    return hubspotRequest(objectPath(objectType), {
      method: "POST",
      json: {
        properties,
        ...(associations ? { associations } : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const hubspotUpdateCustomObjectTool = createTool({
  id: "hubspot_update_custom_object",
  title: "HubSpot: update custom object",
  description: "Update a custom object record's properties by record ID.",
  inputSchema: z.object({
    objectType: customObjectTypeSchema,
    objectId: z.string().min(1).describe("HubSpot record ID"),
    properties: hubspotPropertiesSchema,
    idProperty: z
      .string()
      .optional()
      .describe("Unique property to use instead of the record ID"),
  }),
  outputSchema: hubspotObjectSchema,
  execute: async (
    { objectType, objectId, properties, idProperty },
    { requestContext },
  ) => {
    if (Object.keys(properties).length === 0) {
      throw new Error("Provide at least one property.");
    }

    return hubspotRequest(objectPath(objectType, objectId), {
      method: "PATCH",
      query: { idProperty },
      json: { properties },
      authContext: { requestContext },
    });
  },
});

export const hubspotDeleteCustomObjectTool = createTool({
  id: "hubspot_delete_custom_object",
  title: "HubSpot: delete custom object",
  description: "Archive a custom object record by record ID.",
  inputSchema: z.object({
    objectType: customObjectTypeSchema,
    objectId: z.string().min(1).describe("HubSpot record ID"),
  }),
  outputSchema: z.object({
    archived: z.literal(true),
    id: z.string(),
  }),
  execute: async ({ objectType, objectId }, { requestContext }) => {
    await hubspotRequest(objectPath(objectType, objectId), {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { archived: true as const, id: objectId };
  },
});

export const hubspotCustomObjectTools = {
  hubspotListCustomObjectsTool,
  hubspotSearchCustomObjectsTool,
  hubspotGetCustomObjectTool,
  hubspotCreateCustomObjectTool,
  hubspotUpdateCustomObjectTool,
  hubspotDeleteCustomObjectTool,
};
