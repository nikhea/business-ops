import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import {
  hubspotRecordListSchema,
  hubspotRecordSchema,
} from "./hubspot-shared";

const listIdSchema = z.string().min(1).describe("HubSpot list ID");
const recordIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(10_000)
  .describe("Record IDs to add or remove");

export const hubspotListListsTool = createTool({
  id: "hubspot_list_lists",
  title: "HubSpot: list lists",
  description:
    "List CRM lists (segments) with optional name search and cursor pagination.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe("Items per page (1-500)"),
    after: z.string().optional().describe("Cursor from a previous response"),
    query: z.string().optional().describe("Search list names"),
  }),
  outputSchema: z.looseObject({
    lists: z.array(hubspotRecordSchema),
    paging: z.unknown().optional(),
    total: z.number().optional(),
  }),
  execute: async ({ limit, after, query }, { requestContext }) => {
    return hubspotRequest("/crm/v3/lists", {
      query: { limit, after, query },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetListTool = createTool({
  id: "hubspot_get_list",
  title: "HubSpot: get list",
  description: "Retrieve one CRM list by list ID.",
  inputSchema: z.object({
    listId: listIdSchema,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ listId }, { requestContext }) => {
    return hubspotRequest(`/crm/v3/lists/${encodeURIComponent(listId)}`, {
      authContext: { requestContext },
    });
  },
});

export const hubspotCreateListTool = createTool({
  id: "hubspot_create_list",
  title: "HubSpot: create list",
  description:
    "Create a CRM list. Use objectTypeId 0-1 for contacts. Processing type is usually MANUAL or DYNAMIC.",
  inputSchema: z.object({
    name: z.string().min(1).describe("List name"),
    objectTypeId: z
      .string()
      .min(1)
      .default("0-1")
      .describe("HubSpot object type ID; contacts are 0-1"),
    processingType: z
      .string()
      .min(1)
      .default("MANUAL")
      .describe("List processing type, e.g. MANUAL or DYNAMIC"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ name, objectTypeId, processingType }, { requestContext }) => {
    return hubspotRequest("/crm/v3/lists", {
      method: "POST",
      json: { name, objectTypeId, processingType },
      authContext: { requestContext },
    });
  },
});

export const hubspotUpdateListTool = createTool({
  id: "hubspot_update_list",
  title: "HubSpot: update list",
  description: "Rename an existing CRM list.",
  inputSchema: z.object({
    listId: listIdSchema,
    name: z.string().min(1).describe("New list name"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ listId, name }, { requestContext }) => {
    return hubspotRequest(`/crm/v3/lists/${encodeURIComponent(listId)}`, {
      method: "PUT",
      json: { name },
      authContext: { requestContext },
    });
  },
});

export const hubspotDeleteListTool = createTool({
  id: "hubspot_delete_list",
  title: "HubSpot: delete list",
  description: "Delete a CRM list by list ID.",
  inputSchema: z.object({
    listId: listIdSchema,
  }),
  outputSchema: z.object({
    deleted: z.literal(true),
    listId: z.string(),
  }),
  execute: async ({ listId }, { requestContext }) => {
    await hubspotRequest(`/crm/v3/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
      authContext: { requestContext },
    });

    return { deleted: true as const, listId };
  },
});

export const hubspotListListMembershipsTool = createTool({
  id: "hubspot_list_list_memberships",
  title: "HubSpot: list list memberships",
  description: "List the record IDs in a CRM list.",
  inputSchema: z.object({
    listId: listIdSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Items per page (1-500)"),
    after: z.string().optional().describe("Cursor from a previous response"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ listId, limit, after }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/lists/${encodeURIComponent(listId)}/memberships`,
      {
        query: { limit, after },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotAddListMembersTool = createTool({
  id: "hubspot_add_list_members",
  title: "HubSpot: add list members",
  description: "Add existing records to a manual CRM list.",
  inputSchema: z.object({
    listId: listIdSchema,
    recordIds: recordIdsSchema,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ listId, recordIds }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/lists/${encodeURIComponent(listId)}/memberships/add`,
      {
        method: "PUT",
        json: recordIds,
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotRemoveListMembersTool = createTool({
  id: "hubspot_remove_list_members",
  title: "HubSpot: remove list members",
  description: "Remove records from a manual CRM list.",
  inputSchema: z.object({
    listId: listIdSchema,
    recordIds: recordIdsSchema,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ listId, recordIds }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v3/lists/${encodeURIComponent(listId)}/memberships/remove`,
      {
        method: "PUT",
        json: recordIds,
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotListTools = {
  hubspotListListsTool,
  hubspotGetListTool,
  hubspotCreateListTool,
  hubspotUpdateListTool,
  hubspotDeleteListTool,
  hubspotListListMembershipsTool,
  hubspotAddListMembersTool,
  hubspotRemoveListMembersTool,
};
