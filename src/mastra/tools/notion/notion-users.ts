import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { notionObjectSchema, type NotionObject } from "./notion-shared";
import { notionRequest } from "./notion-auth";

interface UserListResponse {
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
}

const MAX_FETCH_PAGES = 100;

export const notionGetBotUserTool = createTool({
  id: "notion_get_bot_user",
  title: "Notion: get bot user",
  description:
    "Get the Notion bot/user associated with the configured token, including its workspace name and limits.",
  inputSchema: z.object({}),
  outputSchema: notionObjectSchema,
  execute: async (_input, { requestContext }) => {
    return notionRequest<NotionObject>("/users/me", {
      authContext: { requestContext },
    });
  },
});

export const notionListUsersTool = createTool({
  id: "notion_list_users",
  title: "Notion: list users",
  description:
    "List the users in the Notion workspace. Set `fetchAll` to follow pagination.",
  inputSchema: z.object({
    pageSize: z.number().int().min(1).max(100).default(100).describe("Users per page (max 100)"),
    startCursor: z.string().optional().describe("Cursor from a previous page"),
    fetchAll: z
      .boolean()
      .default(false)
      .describe("Follow pagination and return all users (safety cap: 10,000 / 100 pages)"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum users to return across pages"),
  }),
  outputSchema: z.object({
    users: z.array(notionObjectSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    fetchedAll: z.boolean(),
  }),
  execute: async (
    { pageSize, startCursor, fetchAll, maxResults },
    { requestContext },
  ) => {
    const fetchPage = async (cursor?: string) =>
      notionRequest<UserListResponse>("/users", {
        query: { page_size: pageSize, start_cursor: cursor },
        authContext: { requestContext },
      });

    if (!fetchAll) {
      const page = await fetchPage(startCursor);
      return {
        users: page.results ?? [],
        nextCursor: page.next_cursor ?? null,
        hasMore: page.has_more ?? false,
        fetchedAll: !page.has_more,
      };
    }

    const users: NotionObject[] = [];
    let cursor = startCursor;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_FETCH_PAGES) {
      const page = await fetchPage(cursor);
      users.push(...(page.results ?? []));
      if (maxResults !== undefined && users.length >= maxResults) {
        return {
          users: users.slice(0, maxResults),
          nextCursor: page.next_cursor ?? null,
          hasMore: page.has_more ?? false,
          fetchedAll: false,
        };
      }
      cursor = page.next_cursor ?? undefined;
      hasMore = Boolean(page.has_more);
      pages += 1;
    }

    return {
      users,
      nextCursor: hasMore ? (cursor ?? null) : null,
      hasMore,
      fetchedAll: !hasMore,
    };
  },
});

export const notionGetUserTool = createTool({
  id: "notion_get_user",
  title: "Notion: get user",
  description: "Get a Notion user by ID, including person or bot details.",
  inputSchema: z.object({
    userId: z.string().describe("Notion user ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ userId }, { requestContext }) => {
    return notionRequest<NotionObject>(`/users/${encodeURIComponent(userId)}`, {
      authContext: { requestContext },
    });
  },
});

export const notionUserTools = {
  notionGetBotUserTool,
  notionListUsersTool,
  notionGetUserTool,
};
