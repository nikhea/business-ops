import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { runTool } from "../../helpers/tool";
import {
  NotionApiError,
  NotionAuthError,
  resolveNotionToken,
} from "../../../src/mastra/tools/notion/notion-auth";
import { notionUserTools } from "../../../src/mastra/tools/notion/notion-users";
import { notionSearchTools } from "../../../src/mastra/tools/notion/notion-search";
import { notionBlockTools } from "../../../src/mastra/tools/notion/notion-blocks";
import { notionPageTools } from "../../../src/mastra/tools/notion/notion-pages";
import { notionMarkdownTools } from "../../../src/mastra/tools/notion/notion-markdown";
import { notionDatabaseTools } from "../../../src/mastra/tools/notion/notion-databases";
import { notionDataSourceTools } from "../../../src/mastra/tools/notion/notion-data-sources";
import { notionCommentTools } from "../../../src/mastra/tools/notion/notion-comments";

const page = {
  object: "page",
  id: "page-1",
  url: "https://www.notion.so/page-1",
  in_trash: false,
  properties: { title: { type: "title", title: [] } },
};

const block = {
  object: "block",
  id: "block-1",
  type: "paragraph",
  paragraph: { rich_text: [] },
};

function body(call: { body?: string }) {
  return call.body ? JSON.parse(call.body) : undefined;
}

describe("notion tools", () => {
  beforeEach(() => {
    process.env.NOTION_API_TOKEN = "ntn_test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTION_API_TOKEN;
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_VERSION;
  });

  it("throws a clear error when no token is configured", () => {
    delete process.env.NOTION_API_TOKEN;

    expect(() => resolveNotionToken()).toThrow(NotionAuthError);
    expect(() => resolveNotionToken()).toThrow("NOTION_API_TOKEN");
  });

  it("uses the default API version and a per-request token override", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ object: "user", id: "bot-1", type: "bot" }));

    const result = await runTool(
      notionUserTools.notionGetBotUserTool,
      {},
      {
        requestContext: {
          get: (key: string) => (key === "notionAccessToken" ? "ntn_override" : undefined),
        },
      } as never,
    );

    expect(result.id).toBe("bot-1");
    expect(calls[0].url.pathname).toBe("/v1/users/me");
    expect(calls[0].headers.get("authorization")).toBe("Bearer ntn_override");
    expect(calls[0].headers.get("notion-version")).toBe("2026-03-11");
  });

  it("honors a configured NOTION_VERSION", async () => {
    process.env.NOTION_VERSION = "2025-09-03";
    const { calls } = mockGoogleFetch(() => jsonResponse({ object: "user", id: "bot-1" }));

    await runTool(notionUserTools.notionGetBotUserTool, {});

    expect(calls[0].headers.get("notion-version")).toBe("2025-09-03");
  });

  it("lists users and follows pagination", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (!url.searchParams.get("start_cursor")) {
        return jsonResponse({
          object: "list",
          results: [{ object: "user", id: "user-1" }],
          has_more: true,
          next_cursor: "cursor-1",
        });
      }
      return jsonResponse({
        object: "list",
        results: [{ object: "user", id: "user-2" }],
        has_more: false,
        next_cursor: null,
      });
    });

    const result = await runTool(notionUserTools.notionListUsersTool, {
      pageSize: 1,
      fetchAll: true,
    });

    expect(result.users.map((user: { id: string }) => user.id)).toEqual(["user-1", "user-2"]);
    expect(result.fetchedAll).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.searchParams.get("page_size")).toBe("1");
    expect(calls[1].url.searchParams.get("start_cursor")).toBe("cursor-1");
  });

  it("gets a user by ID", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "user", id: "user-1", name: "Ada" }),
    );

    const result = await runTool(notionUserTools.notionGetUserTool, { userId: "user-1" });

    expect(result.name).toBe("Ada");
    expect(calls[0].url.pathname).toBe("/v1/users/user-1");
  });

  it("searches with filters, sort, selected properties, and pagination", async () => {
    const { calls } = mockGoogleFetch((request) => {
      const payload = body(request) as { start_cursor?: string } | undefined;
      if (!payload?.start_cursor) {
        return jsonResponse({
          object: "list",
          type: "page_or_data_source",
          results: [{ object: "page", id: "page-1" }],
          has_more: true,
          next_cursor: "cursor-1",
        });
      }
      return jsonResponse({
        object: "list",
        type: "page_or_data_source",
        results: [{ object: "data_source", id: "ds-1" }],
        has_more: false,
        next_cursor: null,
      });
    });

    const result = await runTool(notionSearchTools.notionSearchTool, {
      query: "Roadmap",
      filter: { property: "object", value: "page" },
      sort: { timestamp: "last_edited_time", direction: "descending" },
      pageSize: 1,
      fetchAll: true,
      filterProperties: ["title", "Status"],
    });

    expect(result.results.map((item: { id: string }) => item.id)).toEqual(["page-1", "ds-1"]);
    expect(result.fetchedAll).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.searchParams.getAll("filter_properties")).toEqual(["title", "Status"]);
    expect(body(calls[0])).toMatchObject({
      query: "Roadmap",
      filter: { property: "object", value: "page" },
      sort: { timestamp: "last_edited_time", direction: "descending" },
      page_size: 1,
    });
  });

  it("gets a block and updates only its writable fields", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(block));

    await runTool(notionBlockTools.notionGetBlockTool, { blockId: "block-1" });
    expect(calls[0].url.pathname).toBe("/v1/blocks/block-1");

    await runTool(notionBlockTools.notionUpdateBlockTool, {
      blockId: "block-1",
      block: {
        object: "block",
        id: "block-1",
        created_time: "2026-01-01T00:00:00.000Z",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "Updated" } }] },
      },
      inTrash: false,
    });

    expect(body(calls[1])).toEqual({
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: "Updated" } }] },
      in_trash: false,
    });
  });

  it("lists block children with pagination and appends positioned blocks", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith("/children") && url.searchParams.get("start_cursor")) {
        return jsonResponse({ object: "list", results: [{ object: "block", id: "block-2" }], has_more: false });
      }
      return jsonResponse({
        object: "list",
        results: [{ object: "block", id: "block-1" }],
        has_more: true,
        next_cursor: "cursor-1",
      });
    });

    const listed = await runTool(notionBlockTools.notionListBlockChildrenTool, {
      blockId: "page-1",
      pageSize: 1,
      fetchAll: true,
    });
    expect(listed.results.map((item: { id: string }) => item.id)).toEqual(["block-1", "block-2"]);
    expect(listed.fetchedAll).toBe(true);

    const appended = await runTool(notionBlockTools.notionAppendBlockChildrenTool, {
      blockId: "page-1",
      children: [{ type: "paragraph", paragraph: { rich_text: [] } }],
      position: { type: "after_block", after_block: { id: "block-1" } },
      notifications: "silent",
    });

    expect(appended.results).toBeDefined();
    expect(body(calls[2])).toEqual({
      children: [{ type: "paragraph", paragraph: { rich_text: [] } }],
      position: { type: "after_block", after_block: { id: "block-1" } },
      notifications: { mode: "silent" },
    });
  });

  it("deletes a block", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ ...block, in_trash: true }));

    const result = await runTool(notionBlockTools.notionDeleteBlockTool, { blockId: "block-1" });

    expect(result.in_trash).toBe(true);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/v1/blocks/block-1");
  });

  it("creates a page with a title shortcut, properties, children, and silent notifications", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(page));

    const result = await runTool(notionPageTools.notionCreatePageTool, {
      parent: { page_id: "parent-1" },
      title: "Roadmap",
      properties: { Status: { select: { name: "Active" } } },
      children: [{ type: "paragraph", paragraph: { rich_text: [] } }],
      notifications: "silent",
    });

    expect(result.id).toBe("page-1");
    expect(body(calls[0])).toEqual({
      parent: { type: "page_id", page_id: "parent-1" },
      properties: {
        Status: { select: { name: "Active" } },
        title: { title: [{ type: "text", text: { content: "Roadmap" } }] },
      },
      children: [{ type: "paragraph", paragraph: { rich_text: [] } }],
      notifications: { mode: "silent" },
    });
  });

  it("creates a page from markdown and rejects conflicting content", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(page));

    await runTool(notionPageTools.notionCreatePageTool, {
      parent: { data_source_id: "ds-1" },
      title: "Task",
      titleProperty: "Name",
      markdown: "# Task",
      markdownVersion: "v2",
      allowAsync: true,
    });

    expect(body(calls[0])).toEqual({
      parent: { type: "data_source_id", data_source_id: "ds-1" },
      properties: { Name: { title: [{ type: "text", text: { content: "Task" } }] } },
      markdown: "# Task",
      markdown_version: "v2",
      allow_async: true,
    });

    await expect(
      runTool(notionPageTools.notionCreatePageTool, {
        parent: { page_id: "parent-1" },
        markdown: "# Task",
        children: [{ type: "paragraph", paragraph: { rich_text: [] } }],
      }),
    ).rejects.toThrow("mutually exclusive");
  });

  it("gets, updates, moves, trashes, and restores a page", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(page));

    await runTool(notionPageTools.notionGetPageTool, {
      pageId: "page-1",
      filterProperties: ["title", "Status"],
    });
    expect(calls[0].url.searchParams.getAll("filter_properties")).toEqual(["title", "Status"]);

    await runTool(notionPageTools.notionUpdatePageTool, {
      pageId: "page-1",
      properties: { Status: { select: { name: "Done" } } },
      inTrash: false,
      isLocked: true,
      eraseContent: true,
    });
    expect(body(calls[1])).toEqual({
      properties: { Status: { select: { name: "Done" } } },
      in_trash: false,
      is_locked: true,
      erase_content: true,
    });

    await runTool(notionPageTools.notionMovePageTool, {
      pageId: "page-1",
      parent: { data_source_id: "ds-2" },
    });
    expect(body(calls[2])).toEqual({
      parent: { type: "data_source_id", data_source_id: "ds-2" },
    });

    await runTool(notionPageTools.notionTrashPageTool, { pageId: "page-1" });
    expect(body(calls[3])).toEqual({ in_trash: true });

    await runTool(notionPageTools.notionRestorePageTool, { pageId: "page-1" });
    expect(body(calls[4])).toEqual({ in_trash: false });
  });

  it("retrieves a single page property item", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "property_item", type: "relation", relation: { id: "rel-1" } }),
    );

    const result = await runTool(notionPageTools.notionGetPagePropertyTool, {
      pageId: "page-1",
      propertyId: "Status",
      pageSize: 25,
      startCursor: "cursor-1",
    });

    expect(result.type).toBe("relation");
    expect(calls[0].url.pathname).toBe("/v1/pages/page-1/properties/Status");
    expect(calls[0].url.searchParams.get("page_size")).toBe("25");
    expect(calls[0].url.searchParams.get("start_cursor")).toBe("cursor-1");
  });

  it("reads page markdown and applies search-and-replace edits", async () => {
    const markdown = {
      object: "page_markdown",
      id: "page-1",
      markdown: "# Title\n\nBody",
      truncated: false,
      unknown_block_ids: [],
    };
    const { calls } = mockGoogleFetch(() => jsonResponse(markdown));

    const retrieved = await runTool(notionMarkdownTools.notionRetrievePageMarkdownTool, {
      pageId: "page-1",
      includeTranscript: true,
      markdownVersion: "v2",
    });

    expect(retrieved.markdown).toContain("# Title");
    expect(calls[0].url.pathname).toBe("/v1/pages/page-1/markdown");
    expect(calls[0].url.searchParams.get("include_transcript")).toBe("true");
    expect(calls[0].url.searchParams.get("markdown_version")).toBe("v2");

    await runTool(notionMarkdownTools.notionUpdatePageMarkdownTool, {
      pageId: "page-1",
      command: "update_content",
      contentUpdates: [
        { oldStr: "Body", newStr: "New body", replaceAllMatches: true },
      ],
      markdownVersion: "v2",
    });

    expect(body(calls[1])).toEqual({
      type: "update_content",
      markdown_version: "v2",
      update_content: {
        content_updates: [
          { old_str: "Body", new_str: "New body", replace_all_matches: true },
        ],
      },
    });
  });

  it("supports full-content and insertion markdown commands", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        object: "page_markdown",
        id: "page-1",
        markdown: "updated",
        truncated: false,
        unknown_block_ids: [],
      }),
    );

    await runTool(notionMarkdownTools.notionUpdatePageMarkdownTool, {
      pageId: "page-1",
      command: "replace_content",
      newStr: "# Replaced",
      allowDeletingContent: true,
    });
    expect(body(calls[0])).toEqual({
      type: "replace_content",
      replace_content: { new_str: "# Replaced", allow_deleting_content: true },
    });

    await runTool(notionMarkdownTools.notionUpdatePageMarkdownTool, {
      pageId: "page-1",
      command: "insert_content",
      content: "## Added",
      position: { type: "start" },
    });
    expect(body(calls[1])).toEqual({
      type: "insert_content",
      insert_content: { content: "## Added", position: { type: "start" } },
    });
  });

  it("queries a data source with filters, sorts, and pagination", async () => {
    const { calls } = mockGoogleFetch((request) => {
      const payload = body(request) as { start_cursor?: string } | undefined;
      if (!payload?.start_cursor) {
        return jsonResponse({
          object: "list",
          type: "page_or_data_source",
          results: [{ object: "page", id: "page-1" }],
          has_more: true,
          next_cursor: "cursor-1",
          request_status: { type: "complete" },
        });
      }
      return jsonResponse({
        object: "list",
        type: "page_or_data_source",
        results: [{ object: "page", id: "page-2" }],
        has_more: false,
        next_cursor: null,
        request_status: { type: "complete" },
      });
    });

    const result = await runTool(notionDataSourceTools.notionQueryDataSourceTool, {
      dataSourceId: "ds-1",
      filter: { property: "Done", checkbox: { equals: true } },
      sorts: [{ property: "Name", direction: "descending" }],
      pageSize: 1,
      filterProperties: ["title", "Status"],
      fetchAll: true,
    });

    expect(result.results.map((item: { id: string }) => item.id)).toEqual(["page-1", "page-2"]);
    expect(result.fetchedAll).toBe(true);
    expect(result.requestStatus).toEqual({ type: "complete" });
    expect(calls[0].url.pathname).toBe("/v1/data_sources/ds-1/query");
    expect(calls[0].url.searchParams.getAll("filter_properties")).toEqual(["title", "Status"]);
    expect(body(calls[0])).toMatchObject({
      filter: { property: "Done", checkbox: { equals: true } },
      sorts: [{ property: "Name", direction: "descending" }],
      page_size: 1,
    });
  });

  it("gets, creates, updates, and lists templates for data sources", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith("/templates") && url.searchParams.get("start_cursor")) {
        return jsonResponse({
          templates: [{ id: "template-2", name: "Second", is_default: false }],
          has_more: false,
          next_cursor: null,
        });
      }
      if (url.pathname.endsWith("/templates")) {
        return jsonResponse({
          templates: [{ id: "template-1", name: "Default", is_default: true }],
          has_more: true,
          next_cursor: "cursor-1",
        });
      }
      return jsonResponse({ object: "data_source", id: "ds-1" });
    });

    await runTool(notionDataSourceTools.notionGetDataSourceTool, { dataSourceId: "ds-1" });
    expect(calls[0].url.pathname).toBe("/v1/data_sources/ds-1");

    await runTool(notionDataSourceTools.notionCreateDataSourceTool, {
      parent: { database_id: "db-1" },
      properties: { Name: { title: {} } },
      title: "Tasks",
    });
    expect(body(calls[1])).toEqual({
      parent: { type: "database_id", database_id: "db-1" },
      properties: { Name: { title: {} } },
      title: [{ type: "text", text: { content: "Tasks" } }],
    });

    await runTool(notionDataSourceTools.notionUpdateDataSourceTool, {
      dataSourceId: "ds-1",
      title: "Renamed",
      parent: { database_id: "db-2" },
      inTrash: false,
    });
    expect(body(calls[2])).toEqual({
      title: [{ type: "text", text: { content: "Renamed" } }],
      parent: { type: "database_id", database_id: "db-2" },
      in_trash: false,
    });

    const templates = await runTool(
      notionDataSourceTools.notionListDataSourceTemplatesTool,
      { dataSourceId: "ds-1", fetchAll: true },
    );
    expect(templates.templates.map((item: { id: string }) => item.id)).toEqual([
      "template-1",
      "template-2",
    ]);
    expect(templates.fetchedAll).toBe(true);
  });

  it("gets, creates, and updates databases", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "database", id: "db-1", data_sources: [{ id: "ds-1" }] }),
    );

    await runTool(notionDatabaseTools.notionGetDatabaseTool, { databaseId: "db-1" });
    expect(calls[0].url.pathname).toBe("/v1/databases/db-1");

    await runTool(notionDatabaseTools.notionCreateDatabaseTool, {
      parent: { page_id: "page-1" },
      title: "Projects",
      description: "All projects",
      isInline: true,
      initialDataSourceProperties: { Name: { title: {} } },
      showDataSourceTitle: false,
    });
    expect(body(calls[1])).toEqual({
      parent: { type: "page_id", page_id: "page-1" },
      title: [{ type: "text", text: { content: "Projects" } }],
      description: [{ type: "text", text: { content: "All projects" } }],
      is_inline: true,
      initial_data_source: { properties: { Name: { title: {} } } },
      show_data_source_title: false,
    });

    await runTool(notionDatabaseTools.notionUpdateDatabaseTool, {
      databaseId: "db-1",
      title: "Renamed",
      inTrash: false,
      isLocked: true,
    });
    expect(body(calls[2])).toEqual({
      title: [{ type: "text", text: { content: "Renamed" } }],
      in_trash: false,
      is_locked: true,
    });

    await expect(
      runTool(notionDatabaseTools.notionCreateDatabaseTool, {
        parent: { page_id: "page-1" },
        databaseType: "tasks",
        initialDataSourceProperties: { Name: { title: {} } },
      }),
    ).rejects.toThrow("cannot both be provided");
  });

  it("creates, lists, updates, retrieves, and deletes comments", async () => {
    const comment = {
      object: "comment",
      id: "comment-1",
      rich_text: [{ plain_text: "Hello" }],
    };
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.searchParams.get("start_cursor")) {
        return jsonResponse({
          object: "list",
          results: [{ object: "comment", id: "comment-2" }],
          has_more: false,
          next_cursor: null,
        });
      }
      if (url.pathname === "/v1/comments" && url.searchParams.has("block_id")) {
        return jsonResponse({
          object: "list",
          results: [comment],
          has_more: true,
          next_cursor: "cursor-1",
        });
      }
      return jsonResponse(comment);
    });

    await runTool(notionCommentTools.notionCreateCommentTool, {
      pageId: "page-1",
      content: "Hello",
      attachments: [{ fileUploadId: "upload-1" }],
      displayName: { custom: "Ops bot" },
    });
    expect(body(calls[0])).toEqual({
      parent: { page_id: "page-1" },
      rich_text: [{ type: "text", text: { content: "Hello" } }],
      attachments: [{ type: "file_upload", file_upload_id: "upload-1" }],
      display_name: { type: "custom", custom: { name: "Ops bot" } },
    });

    const listed = await runTool(notionCommentTools.notionListCommentsTool, {
      blockId: "page-1",
      fetchAll: true,
    });
    expect(listed.comments.map((item: { id: string }) => item.id)).toEqual([
      "comment-1",
      "comment-2",
    ]);
    expect(listed.fetchedAll).toBe(true);

    await runTool(notionCommentTools.notionRetrieveCommentTool, { commentId: "comment-1" });
    expect(calls[3].url.pathname).toBe("/v1/comments/comment-1");

    await runTool(notionCommentTools.notionUpdateCommentTool, {
      commentId: "comment-1",
      markdown: "**Updated**",
      markdownVersion: "v2",
    });
    expect(body(calls[4])).toEqual({ markdown: "**Updated**", markdown_version: "v2" });

    await runTool(notionCommentTools.notionDeleteCommentTool, { commentId: "comment-1" });
    expect(calls[5].method).toBe("DELETE");
  });

  it("rejects comment bodies with multiple content modes", async () => {
    mockGoogleFetch(() => jsonResponse({ object: "comment", id: "comment-1" }));

    await expect(
      runTool(notionCommentTools.notionCreateCommentTool, {
        pageId: "page-1",
        content: "Hello",
        markdown: "**Hello**",
      }),
    ).rejects.toThrow("exactly one");
  });

  it("surfaces Notion API errors with status, code, and request ID", async () => {
    mockGoogleFetch(() =>
      jsonResponse(
        {
          object: "error",
          status: 400,
          code: "validation_error",
          message: "Invalid property",
          request_id: "req-1",
        },
        400,
      ),
    );

    try {
      await runTool(notionPageTools.notionGetPageTool, { pageId: "page-1" });
      throw new Error("Expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotionApiError);
      const apiError = error as NotionApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.code).toBe("validation_error");
      expect(apiError.requestId).toBe("req-1");
      expect(apiError.message).toContain("validation_error: Invalid property");
    }
  });
});
