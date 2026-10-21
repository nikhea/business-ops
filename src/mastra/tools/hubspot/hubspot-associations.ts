import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import {
  hubspotAssociationListSchema,
  hubspotRecordListSchema,
  hubspotRecordSchema,
} from "./hubspot-shared";

const objectTypeSchema = z
  .string()
  .min(1)
  .describe("Object type, e.g. contacts, companies, deals, tickets, or a custom object type ID");

const associationTypeSchema = z.object({
  associationCategory: z
    .enum(["HUBSPOT_DEFINED", "USER_DEFINED"])
    .default("HUBSPOT_DEFINED")
    .describe("Association category"),
  associationTypeId: z
    .number()
    .int()
    .positive()
    .describe("Association type ID from hubspot_list_association_labels"),
});

function associationPath(
  fromObjectType: string,
  fromObjectId: string,
  toObjectType: string,
  toObjectId?: string,
): string {
  const base =
    `/crm/v4/objects/${encodeURIComponent(fromObjectType)}/` +
    `${encodeURIComponent(fromObjectId)}/associations/` +
    encodeURIComponent(toObjectType);

  return toObjectId ? `${base}/${encodeURIComponent(toObjectId)}` : base;
}

export const hubspotListAssociationsTool = createTool({
  id: "hubspot_list_associations",
  title: "HubSpot: list associations",
  description:
    "List records associated with a record. Returns target record IDs and their association types.",
  inputSchema: z.object({
    fromObjectType: objectTypeSchema,
    fromObjectId: z.string().min(1).describe("Source record ID"),
    toObjectType: objectTypeSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Items per page (1-500)"),
    after: z.string().optional().describe("Cursor from a previous response"),
  }),
  outputSchema: hubspotAssociationListSchema,
  execute: async (
    { fromObjectType, fromObjectId, toObjectType, limit, after },
    { requestContext },
  ) => {
    return hubspotRequest(
      associationPath(fromObjectType, fromObjectId, toObjectType),
      {
        query: { limit, after },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotCreateAssociationTool = createTool({
  id: "hubspot_create_association",
  title: "HubSpot: create association",
  description:
    "Associate two records. Get the association type ID from hubspot_list_association_labels first.",
  inputSchema: z.object({
    fromObjectType: objectTypeSchema,
    fromObjectId: z.string().min(1).describe("Source record ID"),
    toObjectType: objectTypeSchema,
    toObjectId: z.string().min(1).describe("Target record ID"),
    associationCategory: associationTypeSchema.shape.associationCategory,
    associationTypeId: associationTypeSchema.shape.associationTypeId,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async (
    {
      fromObjectType,
      fromObjectId,
      toObjectType,
      toObjectId,
      associationCategory,
      associationTypeId,
    },
    { requestContext },
  ) => {
    const result = await hubspotRequest<Record<string, unknown> | undefined>(
      associationPath(fromObjectType, fromObjectId, toObjectType, toObjectId),
      {
        method: "PUT",
        json: [{ associationCategory, associationTypeId }],
        authContext: { requestContext },
      },
    );

    return result ?? { associated: true };
  },
});

export const hubspotDeleteAssociationTool = createTool({
  id: "hubspot_delete_association",
  title: "HubSpot: delete association",
  description: "Remove an association between two records.",
  inputSchema: z.object({
    fromObjectType: objectTypeSchema,
    fromObjectId: z.string().min(1).describe("Source record ID"),
    toObjectType: objectTypeSchema,
    toObjectId: z.string().min(1).describe("Target record ID"),
    associationCategory: associationTypeSchema.shape.associationCategory,
    associationTypeId: associationTypeSchema.shape.associationTypeId,
  }),
  outputSchema: z.object({
    deleted: z.literal(true),
  }),
  execute: async (
    {
      fromObjectType,
      fromObjectId,
      toObjectType,
      toObjectId,
      associationCategory,
      associationTypeId,
    },
    { requestContext },
  ) => {
    await hubspotRequest(
      associationPath(fromObjectType, fromObjectId, toObjectType, toObjectId),
      {
        method: "DELETE",
        json: [{ associationCategory, associationTypeId }],
        authContext: { requestContext },
      },
    );

    return { deleted: true as const };
  },
});

export const hubspotListAssociationLabelsTool = createTool({
  id: "hubspot_list_association_labels",
  title: "HubSpot: list association labels",
  description:
    "List the association types and labels available between two object types. " +
    "Use the returned typeId values when creating or deleting associations.",
  inputSchema: z.object({
    fromObjectType: objectTypeSchema,
    toObjectType: objectTypeSchema,
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ fromObjectType, toObjectType }, { requestContext }) => {
    return hubspotRequest(
      `/crm/v4/associations/${encodeURIComponent(fromObjectType)}/` +
        `${encodeURIComponent(toObjectType)}/labels`,
      { authContext: { requestContext } },
    );
  },
});

export const hubspotAssociationTools = {
  hubspotListAssociationsTool,
  hubspotCreateAssociationTool,
  hubspotDeleteAssociationTool,
  hubspotListAssociationLabelsTool,
};
