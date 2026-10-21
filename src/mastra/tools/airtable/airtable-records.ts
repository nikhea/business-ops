import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { airtableRequest } from "./airtable-auth";

const MAX_BATCH_SIZE = 10;
const MAX_FETCH_PAGES = 100;

interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
  commentCount?: number;
}

interface AirtableListResponse {
  records?: AirtableRecord[];
  offset?: string;
}

interface AirtableWriteResponse {
  records?: AirtableRecord[];
  createdRecords?: string[];
  updatedRecords?: string[];
  details?: { message?: string; reasons?: string[] };
}

const recordSchema = z.object({
  id: z.string(),
  createdTime: z.string().optional(),
  fields: z.record(z.string(), z.unknown()),
  commentCount: z.number().optional(),
});

const writeDetailsSchema = z.object({
  message: z.string().optional(),
  reasons: z.array(z.string()).optional(),
});

const fieldValuesSchema = z
  .record(z.string(), z.unknown())
  .describe("Cell values keyed by field name or field ID");

function tablePath(baseId: string, table: string): string {
  return `/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
}

function recordPath(baseId: string, table: string, recordId: string): string {
  return `${tablePath(baseId, table)}/${encodeURIComponent(recordId)}`;
}

export const airtableListRecordsTool = createTool({
  id: "airtable_list_records",
  title: "Airtable: list records",
  description:
    "List records in an Airtable table with filtering, sorting, view selection, and field selection. " +
    "Set `fetchAll` to follow pagination and return every matching record (up to 10,000).",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID (starts with app)"),
    table: z.string().describe("Table name or table ID (starts with tbl)"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Records per page (max 100)"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe("Follow offset pagination and return all records (safety cap: 10,000 / 100 pages)"),
    maxRecords: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum total records to return across pages"),
    offset: z.string().optional().describe("Offset from a previous page; ignored when fetchAll is true"),
    view: z.string().optional().describe("View name or ID"),
    filterByFormula: z
      .string()
      .optional()
      .describe("Airtable formula, e.g. {Status} = 'Open'. Do not pre-encode it"),
    sort: z
      .array(
        z.object({
          field: z.string(),
          direction: z.enum(["asc", "desc"]).default("asc"),
        }),
      )
      .optional()
      .describe("Sort order; overrides the view's order"),
    fields: z.array(z.string()).optional().describe("Only return these field names or IDs"),
    cellFormat: z
      .enum(["json", "string"])
      .optional()
      .describe("Cell format; 'string' requires timeZone and userLocale"),
    timeZone: z.string().optional().describe("Time zone for string cell formatting"),
    userLocale: z.string().optional().describe("Locale for string cell formatting"),
    returnFieldsByFieldId: z
      .boolean()
      .default(false)
      .describe("Key the fields object by field ID instead of field name"),
  }),
  outputSchema: z.object({
    records: z.array(recordSchema),
    offset: z.string().optional(),
    fetchedAll: z.boolean(),
  }),
  execute: async (
    {
      baseId,
      table,
      pageSize,
      fetchAll,
      maxRecords,
      offset: initialOffset,
      view,
      filterByFormula,
      sort,
      fields,
      cellFormat,
      timeZone,
      userLocale,
      returnFieldsByFieldId,
    },
    { requestContext },
  ) => {
    if (cellFormat === "string" && (!timeZone || !userLocale)) {
      throw new Error("timeZone and userLocale are required when cellFormat is 'string'.");
    }

    const query: Record<string, unknown> = {
      pageSize,
      maxRecords,
      view,
      filterByFormula,
      cellFormat,
      timeZone,
      userLocale,
      returnFieldsByFieldId,
      "fields[]": fields,
    };

    sort?.forEach((item, index) => {
      query[`sort[${index}][field]`] = item.field;
      query[`sort[${index}][direction]`] = item.direction;
    });

    const fetchPage = async (offset?: string) =>
      airtableRequest<AirtableListResponse>(tablePath(baseId, table), {
        query: { ...query, offset },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(initialOffset);

      return {
        records: page.records ?? [],
        offset: page.offset,
        fetchedAll: !page.offset,
      };
    }

    const records: AirtableRecord[] = [];
    let offset = initialOffset;
    let pages = 0;

    do {
      const page = await fetchPage(offset);
      records.push(...(page.records ?? []));
      offset = page.offset;
      pages += 1;
    } while (offset && pages < MAX_FETCH_PAGES);

    return {
      records,
      offset,
      fetchedAll: !offset,
    };
  },
});

export const airtableGetRecordTool = createTool({
  id: "airtable_get_record",
  title: "Airtable: get record",
  description: "Get a single Airtable record by ID.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordId: z.string().describe("Record ID (starts with rec)"),
  }),
  outputSchema: recordSchema,
  execute: async ({ baseId, table, recordId }, { requestContext }) => {
    const record = await airtableRequest<AirtableRecord>(
      recordPath(baseId, table, recordId),
      { authContext: { requestContext } },
    );

    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: record.fields ?? {},
      commentCount: record.commentCount,
    };
  },
});

export const airtableCreateRecordsTool = createTool({
  id: "airtable_create_records",
  title: "Airtable: create records",
  description:
    "Create up to 10 records in one Airtable request. Set `typecast` to let Airtable coerce string values.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    records: z
      .array(z.object({ fields: fieldValuesSchema }))
      .min(1)
      .max(MAX_BATCH_SIZE)
      .describe("Records to create (max 10)"),
    typecast: z.boolean().default(false).describe("Best-effort automatic type conversion"),
    returnFieldsByFieldId: z.boolean().default(false).describe("Key response fields by field ID"),
  }),
  outputSchema: z.object({
    records: z.array(recordSchema),
    details: writeDetailsSchema.optional(),
  }),
  execute: async (
    { baseId, table, records, typecast, returnFieldsByFieldId },
    { requestContext },
  ) => {
    const result = await airtableRequest<AirtableWriteResponse>(tablePath(baseId, table), {
      method: "POST",
      json: { records, typecast, returnFieldsByFieldId },
      authContext: { requestContext },
    });

    return {
      records: (result.records ?? []).map((record) => ({
        id: record.id,
        createdTime: record.createdTime,
        fields: record.fields ?? {},
      })),
      details: result.details,
    };
  },
});

export const airtableUpdateRecordsTool = createTool({
  id: "airtable_update_records",
  title: "Airtable: update records",
  description:
    "PATCH up to 10 records: only supplied fields change. Set `performUpsert` to create records that do not match on the merge fields.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    records: z
      .array(
        z.object({
          id: z.string().optional().describe("Record ID; optional only when performUpsert is set"),
          fields: fieldValuesSchema,
        }),
      )
      .min(1)
      .max(MAX_BATCH_SIZE)
      .describe("Records to update (max 10)"),
    performUpsert: z
      .object({
        fieldsToMergeOn: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe("Field names or IDs that uniquely identify a record"),
      })
      .optional()
      .describe("Enable upsert behavior"),
    typecast: z.boolean().default(false).describe("Best-effort automatic type conversion"),
    returnFieldsByFieldId: z.boolean().default(false).describe("Key response fields by field ID"),
  }),
  outputSchema: z.object({
    records: z.array(recordSchema),
    createdRecords: z.array(z.string()).optional(),
    updatedRecords: z.array(z.string()).optional(),
    details: writeDetailsSchema.optional(),
  }),
  execute: async (
    { baseId, table, records, performUpsert, typecast, returnFieldsByFieldId },
    { requestContext },
  ) => {
    if (!performUpsert && records.some((record) => !record.id)) {
      throw new Error("Every record needs an id unless performUpsert is set.");
    }

    const result = await airtableRequest<AirtableWriteResponse>(tablePath(baseId, table), {
      method: "PATCH",
      json: { records, performUpsert, typecast, returnFieldsByFieldId },
      authContext: { requestContext },
    });

    return {
      records: (result.records ?? []).map((record) => ({
        id: record.id,
        createdTime: record.createdTime,
        fields: record.fields ?? {},
      })),
      createdRecords: result.createdRecords,
      updatedRecords: result.updatedRecords,
      details: result.details,
    };
  },
});

export const airtableReplaceRecordsTool = createTool({
  id: "airtable_replace_records",
  title: "Airtable: replace records",
  description:
    "PUT up to 10 records: clears every field that is not included in the request. Use the update tool for non-destructive edits.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    records: z
      .array(
        z.object({
          id: z.string().describe("Record ID"),
          fields: fieldValuesSchema,
        }),
      )
      .min(1)
      .max(MAX_BATCH_SIZE)
      .describe("Records to replace (max 10)"),
    typecast: z.boolean().default(false).describe("Best-effort automatic type conversion"),
    returnFieldsByFieldId: z.boolean().default(false).describe("Key response fields by field ID"),
  }),
  outputSchema: z.object({
    records: z.array(recordSchema),
    details: writeDetailsSchema.optional(),
  }),
  execute: async (
    { baseId, table, records, typecast, returnFieldsByFieldId },
    { requestContext },
  ) => {
    const result = await airtableRequest<AirtableWriteResponse>(tablePath(baseId, table), {
      method: "PUT",
      json: { records, typecast, returnFieldsByFieldId },
      authContext: { requestContext },
    });

    return {
      records: (result.records ?? []).map((record) => ({
        id: record.id,
        createdTime: record.createdTime,
        fields: record.fields ?? {},
      })),
      details: result.details,
    };
  },
});

export const airtableDeleteRecordsTool = createTool({
  id: "airtable_delete_records",
  title: "Airtable: delete records",
  description: "Delete up to 10 Airtable records by ID in one request.",
  inputSchema: z.object({
    baseId: z.string().describe("Airtable base ID"),
    table: z.string().describe("Table name or table ID"),
    recordIds: z
      .array(z.string())
      .min(1)
      .max(MAX_BATCH_SIZE)
      .describe("Record IDs to delete (max 10)"),
  }),
  outputSchema: z.object({
    records: z.array(z.object({ id: z.string(), deleted: z.boolean() })),
  }),
  execute: async ({ baseId, table, recordIds }, { requestContext }) => {
    const result = await airtableRequest<{
      records?: { id: string; deleted: boolean }[];
    }>(tablePath(baseId, table), {
      method: "DELETE",
      query: { "records[]": recordIds },
      authContext: { requestContext },
    });

    return {
      records: result.records ?? [],
    };
  },
});

export const airtableRecordTools = {
  airtableListRecordsTool,
  airtableGetRecordTool,
  airtableCreateRecordsTool,
  airtableUpdateRecordsTool,
  airtableReplaceRecordsTool,
  airtableDeleteRecordsTool,
};
