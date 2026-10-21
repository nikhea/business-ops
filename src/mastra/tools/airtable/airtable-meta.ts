import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { airtableRequest } from "./airtable-auth";

interface AirtableBase {
  id: string;
  name: string;
  permissionLevel: string;
}

interface AirtableTable {
  id: string;
  name: string;
  description?: string;
  primaryFieldId: string;
  fields?: {
    id: string;
    name: string;
    type: string;
    description?: string;
    options?: unknown;
  }[];
  views?: {
    id: string;
    name: string;
    type: string;
    visibleFieldIds?: string[];
  }[];
}

const baseSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissionLevel: z.string(),
});

const tableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  primaryFieldId: z.string(),
  fields: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      description: z.string().optional(),
      options: z.unknown().optional(),
    }),
  ),
  views: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      visibleFieldIds: z.array(z.string()).optional(),
    }),
  ),
});

function mapTable(table: AirtableTable) {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    primaryFieldId: table.primaryFieldId,
    fields: (table.fields ?? []).map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      description: field.description,
      options: field.options,
    })),
    views: (table.views ?? []).map((view) => ({
      id: view.id,
      name: view.name,
      type: view.type,
      visibleFieldIds: view.visibleFieldIds,
    })),
  };
}

export const airtableListBasesTool = createTool({
  id: "airtable_list_bases",
  title: "Airtable: list bases",
  description:
    "List the Airtable bases the token can access (up to 1,000 per page), with permission levels.",
  inputSchema: z.object({
    offset: z.string().optional().describe("Offset from a previous page"),
  }),
  outputSchema: z.object({
    bases: z.array(baseSchema),
    offset: z.string().optional(),
  }),
  execute: async ({ offset }, { requestContext }) => {
    const result = await airtableRequest<{ bases?: AirtableBase[]; offset?: string }>(
      "/meta/bases",
      {
        query: { offset },
        authContext: { requestContext },
      },
    );

    return {
      bases: result.bases ?? [],
      offset: result.offset,
    };
  },
});

export const airtableListTablesTool = createTool({
  id: "airtable_list_tables",
  title: "Airtable: list tables",
  description:
    "Get the schema of a base: tables, fields, field types/options, primary fields, and views.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    includeVisibleFieldIds: z
      .boolean()
      .default(false)
      .describe("Include visibleFieldIds on grid views"),
  }),
  outputSchema: z.object({
    tables: z.array(tableSchema),
  }),
  execute: async ({ baseId, includeVisibleFieldIds }, { requestContext }) => {
    const result = await airtableRequest<{ tables?: AirtableTable[] }>(
      `/meta/bases/${encodeURIComponent(baseId)}/tables`,
      {
        query: includeVisibleFieldIds ? { "include[]": ["visibleFieldIds"] } : undefined,
        authContext: { requestContext },
      },
    );

    return {
      tables: (result.tables ?? []).map(mapTable),
    };
  },
});

export const airtableMetaTools = {
  airtableListBasesTool,
  airtableListTablesTool,
};
