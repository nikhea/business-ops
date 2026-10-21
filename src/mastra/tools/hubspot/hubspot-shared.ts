import { z } from "zod";

/**
 * HubSpot CRM responses include standard fields plus account-specific
 * properties. Loose output schemas preserve every returned field.
 */
export const hubspotRecordSchema = z.record(z.string(), z.unknown());

export const hubspotObjectSchema = z.looseObject({
  id: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().optional(),
  url: z.string().optional(),
  associations: z.record(z.string(), z.unknown()).optional(),
});

export const hubspotListSchema = z.looseObject({
  results: z.array(hubspotObjectSchema),
  paging: z.unknown().optional(),
  total: z.number().optional(),
});

export const hubspotRecordListSchema = z.looseObject({
  results: z.array(hubspotRecordSchema),
  paging: z.unknown().optional(),
  total: z.number().optional(),
});

export const hubspotPaginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Items per page (1-100)"),
  after: z.string().optional().describe("Cursor from a previous response"),
});

export const hubspotObjectListSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Items per page (1-100)"),
  after: z.string().optional().describe("Cursor from a previous response"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Only return these property names"),
  associations: z
    .array(z.string())
    .optional()
    .describe("Include associations for these object types"),
  archived: z.boolean().optional().describe("Include archived records"),
});

export const hubspotObjectGetSchema = z.object({
  objectId: z.string().min(1).describe("HubSpot record ID"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Only return these property names"),
  associations: z
    .array(z.string())
    .optional()
    .describe("Include associations for these object types"),
  archived: z.boolean().optional().describe("Include the record if it is archived"),
  idProperty: z
    .string()
    .optional()
    .describe("Unique property to use instead of the record ID, e.g. email"),
});

export const hubspotPropertiesSchema = z
  .record(z.string(), z.unknown())
  .describe("Property values keyed by HubSpot internal property name");

export const hubspotAssociationInputSchema = z.object({
  to: z.object({ id: z.string().min(1) }).describe("Target record"),
  types: z
    .array(
      z.object({
        associationCategory: z
          .enum(["HUBSPOT_DEFINED", "USER_DEFINED"])
          .describe("Association category"),
        associationTypeId: z
          .number()
          .int()
          .positive()
          .describe("Association type ID from hubspot_list_association_labels"),
      }),
    )
    .min(1)
    .describe("Association types to create"),
});

export const hubspotAssociationListSchema = z.looseObject({
  results: z.array(hubspotRecordSchema),
  paging: z.unknown().optional(),
  total: z.number().optional(),
});

const searchFilterSchema = z.object({
  propertyName: z.string().describe("Internal property name"),
  operator: z
    .enum([
      "EQ",
      "NEQ",
      "LT",
      "LTE",
      "GT",
      "GTE",
      "BETWEEN",
      "IN",
      "NOT_IN",
      "HAS_PROPERTY",
      "NOT_HAS_PROPERTY",
      "CONTAINS_TOKEN",
      "NOT_CONTAINS_TOKEN",
    ])
    .describe("HubSpot search operator"),
  value: z.string().optional().describe("Value for single-value operators"),
  values: z.array(z.string()).optional().describe("Values for IN and NOT_IN"),
  highValue: z.string().optional().describe("Upper bound for BETWEEN"),
});

export const hubspotSearchSchema = z.object({
  filterGroups: z
    .array(
      z.object({
        filters: z.array(searchFilterSchema).min(1).describe("Filters in this group"),
      }),
    )
    .optional()
    .describe("Filter groups; filters within a group are ANDed, groups are ORed"),
  sorts: z
    .array(
      z.object({
        propertyName: z.string(),
        direction: z.enum(["ASC", "DESC"]).default("ASC"),
      }),
    )
    .optional()
    .describe("Sort order"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Only return these property names"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe("Items per page (1-100)"),
  after: z.string().optional().describe("Cursor from a previous response"),
  query: z.string().optional().describe("Full-text search query"),
});

export type HubspotSearchInput = z.infer<typeof hubspotSearchSchema>;

export function objectPath(objectType: string, objectId?: string): string {
  const base = `/crm/v3/objects/${encodeURIComponent(objectType)}`;
  return objectId ? `${base}/${encodeURIComponent(objectId)}` : base;
}

export function listQuery(input: {
  limit?: number;
  after?: string;
  properties?: string[];
  associations?: string[];
  archived?: boolean;
}): Record<string, unknown> {
  return {
    limit: input.limit,
    after: input.after,
    properties: input.properties,
    associations: input.associations,
    archived: input.archived,
  };
}

export function getQuery(input: {
  properties?: string[];
  associations?: string[];
  archived?: boolean;
  idProperty?: string;
}): Record<string, unknown> {
  return {
    properties: input.properties,
    associations: input.associations,
    archived: input.archived,
    idProperty: input.idProperty,
  };
}

export function searchBody(input: HubspotSearchInput): Record<string, unknown> {
  return {
    ...(input.filterGroups ? { filterGroups: input.filterGroups } : {}),
    ...(input.sorts ? { sorts: input.sorts } : {}),
    ...(input.properties ? { properties: input.properties } : {}),
    limit: input.limit,
    ...(input.after ? { after: input.after } : {}),
    ...(input.query ? { query: input.query } : {}),
  };
}
