import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listSchema, type NotionObject } from "./notion-shared";
import { notionRequest } from "./notion-auth";

interface SearchResponse {
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
  type?: string;
  request_status?: unknown;
}

const searchFilterSchema = z.union([
  z.object({
    property: z.literal("object"),
    value: z.enum(["page", "data_source"]),
    in_trash: z.boolean().optional().describe("Search the trash instead of active content"),
  }),
  z.object({
    in_trash: z.boolean().describe("Search only the trash"),
  }),
]);

const searchSortSchema = z.union([
  z.object({
    timestamp: z.literal("last_edited_time"),
    direction: z.enum(["ascending", "descending"]),
  }),
  z.object({
    property: z.literal("relevance"),
  }),
]);

const MAX_FETCH_PAGES = 100;

export const notionSearchTool = createTool({
  id: "notion_search",
  title: "Notion: search",
  description:
    "Search pages and data sources shared with the connection by title. With no query, " +
    "returns everything shared with the connection. Set `fetchAll` to follow pagination.",
  inputSchema: z.object({
    query: z.string().optional().describe("Title text to search for"),
    filter: searchFilterSchema
      .optional()
      .describe("Limit results to pages or data sources, optionally in the trash"),
    sort: searchSortSchema.optional().describe("Sort by last edited time or relevance"),
    pageSize: z.number().int().min(1).max(100).default(100).describe("Results per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe("Follow pagination and return all matches (safety cap: 10,000 / 100 pages)"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum results to return across pages"),
    filterProperties: z
      .array(z.string())
      .optional()
      .describe("Only return these page property names or IDs on each result"),
  }),
  outputSchema: listSchema.extend({
    fetchedAll: z.boolean(),
  }),
  execute: async (
    { query, filter, sort, pageSize, startCursor, fetchAll, maxResults, filterProperties },
    { requestContext },
  ) => {
    const fetchPage = async (cursor?: string) =>
      notionRequest<SearchResponse>("/search", {
        method: "POST",
        query: { filter_properties: filterProperties },
        json: {
          query,
          filter,
          sort,
          page_size: pageSize,
          start_cursor: cursor,
        },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        results: page.results ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        type: page.type,
        requestStatus: page.request_status,
        fetchedAll: !page.has_more,
      };
    }

    const results: NotionObject[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      results.push(...(page.results ?? []));
      if (maxResults !== undefined && results.length >= maxResults) {
        return {
          results: results.slice(0, maxResults),
          nextCursor: page.next_cursor ?? null,
          hasMore: page.has_more ?? false,
          type: page.type,
          requestStatus: page.request_status,
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
      requestStatus: undefined,
      fetchedAll: !hasMore,
    };
  },
});

export const notionSearchTools = {
  notionSearchTool,
};
