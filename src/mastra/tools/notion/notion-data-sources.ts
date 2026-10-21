import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  listSchema,
  normalizeParent,
  notionObjectSchema,
  parentInputSchema,
  richText,
  type NotionObject,
} from "./notion-shared";
import { notionRequest } from "./notion-auth";

interface QueryResponse {
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
  type?: string;
  request_status?: unknown;
}

interface TemplateListResponse {
  templates?: { id: string; name: string; is_default: boolean }[];
  next_cursor?: string | null;
  has_more?: boolean;
}

const MAX_FETCH_PAGES = 100;

const sortSchema = z.union([
  z.object({
    property: z.string(),
    direction: z.enum(["ascending", "descending"]),
  }),
  z.object({
    timestamp: z.enum(["created_time", "last_edited_time"]),
    direction: z.enum(["ascending", "descending"]),
  }),
]);

export const notionQueryDataSourceTool = createTool({
  id: "notion_query_data_source",
  title: "Notion: query data source",
  description:
    "Query the pages in a data source with filters and sorts. Get the data source ID from " +
    "`notion_get_database`. Set `fetchAll` to follow pagination (up to 10,000 rows per query).",
  inputSchema: z.object({
    dataSourceId: z.string().describe("Data source ID"),
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Notion filter object, including and/or compound filters"),
    sorts: z.array(sortSchema).optional().describe("Sort conditions, in priority order"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Rows per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    isArchived: z
      .boolean()
      .optional()
      .describe("Query archived rows instead of active rows"),
    resultType: z
      .enum(["page", "data_source"])
      .optional()
      .describe("Only return pages or data sources (wiki data sources)"),
    filterProperties: z
      .array(z.string())
      .optional()
      .describe("Only return these property names or IDs"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe("Follow pagination and return all rows (safety cap: 10,000 / 100 pages)"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum rows to return across pages"),
  }),
  outputSchema: listSchema.extend({
    fetchedAll: z.boolean(),
  }),
  execute: async (
    {
      dataSourceId,
      filter,
      sorts,
      pageSize,
      startCursor,
      isArchived,
      resultType,
      filterProperties,
      fetchAll,
      maxResults,
    },
    { requestContext },
  ) => {
    const path = `/data_sources/${encodeURIComponent(dataSourceId)}/query`;
    const fetchPage = async (cursor?: string) =>
      notionRequest<QueryResponse>(path, {
        method: "POST",
        query: { filter_properties: filterProperties },
        json: {
          filter,
          sorts,
          page_size: pageSize,
          start_cursor: cursor,
          is_archived: isArchived,
          result_type: resultType,
        },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        results: page.results ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        type: page.type ?? "page_or_data_source",
        requestStatus: page.request_status,
        fetchedAll: !page.has_more,
      };
    }

    const results: NotionObject[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;
    let requestStatus: unknown;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      results.push(...(page.results ?? []));
      requestStatus = page.request_status ?? requestStatus;
      if (maxResults !== undefined && results.length >= maxResults) {
        return {
          results: results.slice(0, maxResults),
          nextCursor: page.next_cursor ?? null,
          hasMore: page.has_more ?? false,
          type: page.type ?? "page_or_data_source",
          requestStatus,
          fetchedAll: false,
        };
      }
      cursor = page.next_cursor ?? undefined;
      hasMore = Boolean(page.has_more);
      pages += 1;
    }

    return {
      results,
      nextCursor: hasMore ? (cursor ?? null) : null,
      hasMore,
      type: "page_or_data_source",
      requestStatus,
      fetchedAll: !hasMore,
    };
  },
});

export const notionGetDataSourceTool = createTool({
  id: "notion_get_data_source",
  title: "Notion: get data source",
  description:
    "Retrieve a data source schema, including property names, types, and options. " +
    "Use the data source ID with `notion_query_data_source` and `notion_create_page`.",
  inputSchema: z.object({
    dataSourceId: z.string().describe("Data source ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ dataSourceId }, { requestContext }) => {
    return notionRequest<NotionObject>(
      `/data_sources/${encodeURIComponent(dataSourceId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const notionCreateDataSourceTool = createTool({
  id: "notion_create_data_source",
  title: "Notion: create data source",
  description:
    "Add another data source (table) to an existing Notion database. The `properties` object " +
    "uses the same schema as Notion data source properties.",
  inputSchema: z.object({
    parent: parentInputSchema,
    properties: z
      .record(z.string(), z.unknown())
      .describe("Property schema for the data source"),
    title: z.string().optional().describe("Data source title"),
    icon: z.unknown().optional().describe("Notion icon object"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ parent, properties, title, icon }, { requestContext }) => {
    const normalizedParent = normalizeParent(parent, ["database_id"]);

    return notionRequest<NotionObject>("/data_sources", {
      method: "POST",
      json: {
        parent: normalizedParent,
        properties,
        ...(title !== undefined ? { title: richText(title) } : {}),
        ...(icon !== undefined ? { icon } : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const notionUpdateDataSourceTool = createTool({
  id: "notion_update_data_source",
  title: "Notion: update data source",
  description:
    "Update a data source's title, icon, property schema, parent database, or trash state. " +
    "Schema changes affect every page in the data source.",
  inputSchema: z.object({
    dataSourceId: z.string().describe("Data source ID"),
    title: z.string().optional().describe("New title"),
    icon: z.unknown().optional().describe("Notion icon object"),
    properties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Property schema changes keyed by property name"),
    parent: parentInputSchema.optional().describe("Move the data source to another database"),
    inTrash: z.boolean().optional().describe("Move the data source to or from the trash"),
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    { dataSourceId, title, icon, properties, parent, inTrash },
    { requestContext },
  ) => {
    const body: Record<string, unknown> = {
      ...(title !== undefined ? { title: richText(title) } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(properties !== undefined ? { properties } : {}),
      ...(parent !== undefined
        ? { parent: normalizeParent(parent, ["database_id"]) }
        : {}),
      ...(inTrash !== undefined ? { in_trash: inTrash } : {}),
    };

    if (Object.keys(body).length === 0) {
      throw new Error("Provide at least one data source field to update.");
    }

    return notionRequest<NotionObject>(
      `/data_sources/${encodeURIComponent(dataSourceId)}`,
      {
        method: "PATCH",
        json: body,
        authContext: { requestContext },
      },
    );
  },
});

export const notionListDataSourceTemplatesTool = createTool({
  id: "notion_list_data_source_templates",
  title: "Notion: list data source templates",
  description:
    "List the page templates configured on a data source, including which one is the default. " +
    "Use a template ID with `notion_create_page`.",
  inputSchema: z.object({
    dataSourceId: z.string().describe("Data source ID"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    fetchAll: z.boolean().default(false).describe("Follow pagination and return all templates"),
  }),
  outputSchema: z.object({
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        is_default: z.boolean(),
      }),
    ),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    fetchedAll: z.boolean(),
  }),
  execute: async ({ dataSourceId, startCursor, fetchAll }, { requestContext }) => {
    const path = `/data_sources/${encodeURIComponent(dataSourceId)}/templates`;
    const fetchPage = async (cursor?: string) =>
      notionRequest<TemplateListResponse>(path, {
        query: { start_cursor: cursor },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        templates: page.templates ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        fetchedAll: !page.has_more,
      };
    }

    const templates: { id: string; name: string; is_default: boolean }[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      templates.push(...(page.templates ?? []));
      cursor = page.next_cursor ?? undefined;
      hasMore = Boolean(page.has_more);
      pages += 1;
    }

    return {
      templates,
      nextCursor: hasMore ? (cursor ?? null) : null,
      hasMore,
      fetchedAll: !hasMore,
    };
  },
});

export const notionDataSourceTools = {
  notionQueryDataSourceTool,
  notionGetDataSourceTool,
  notionCreateDataSourceTool,
  notionUpdateDataSourceTool,
  notionListDataSourceTemplatesTool,
};
