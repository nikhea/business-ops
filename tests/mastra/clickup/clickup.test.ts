import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { runTool } from "../../helpers/tool";
import {
  ClickUpApiError,
  ClickUpAuthError,
  resolveClickUpToken,
} from "../../../src/mastra/tools/clickup/clickup-auth";
import { clickupWorkspaceTools } from "../../../src/mastra/tools/clickup/clickup-workspace";
import { clickupTaskTools } from "../../../src/mastra/tools/clickup/clickup-tasks";
import { clickupCommentTools } from "../../../src/mastra/tools/clickup/clickup-comments";
import { clickupTimeTools } from "../../../src/mastra/tools/clickup/clickup-time";
import { clickupFieldTools } from "../../../src/mastra/tools/clickup/clickup-fields";
import { clickupWebhookTools } from "../../../src/mastra/tools/clickup/clickup-webhooks";
import { clickupChecklistTools } from "../../../src/mastra/tools/clickup/clickup-checklists";

const team = {
  id: "90152648112",
  name: "Test Workspace",
  color: "#40BC86",
  avatar: null,
  members: [],
};

const space = {
  id: "space1",
  name: "Team Space",
  private: false,
  statuses: [{ id: "s1", status: "to do", type: "open" }],
  multiple_assignees: true,
  features: { time_tracking: { enabled: true } },
};

const folder = {
  id: "folder1",
  name: "Folder",
  task_count: "2",
  lists: [],
  space: { id: "space1", name: "Team Space", access: true },
};

const list = {
  id: "list1",
  name: "Project 2",
  task_count: 3,
  statuses: [{ id: "s1", status: "to do", type: "open" }],
  space: { id: "space1", name: "Team Space" },
};

const task = {
  id: "task1",
  name: "Task 1",
  status: { id: "s1", status: "to do", type: "open" },
  assignees: [],
  tags: [],
  custom_fields: [],
  url: "https://app.clickup.com/t/task1",
};

const comment = {
  id: "comment1",
  comment_text: "Hello",
  user: { id: 302682250, username: "Ada" },
  resolved: false,
  date: "1792597300000",
  reply_count: "0",
};

const timeEntry = {
  id: "time1",
  start: "1792597300000",
  end: "1792597360000",
  duration: "60000",
  description: "Work",
  billable: false,
  tags: [],
  task: null,
};

const webhook = {
  id: "wh1",
  endpoint: "https://example.com/hook",
  events: ["taskCreated"],
  health: { status: "active", fail_count: 0 },
  secret: "secret",
};

const checklist = {
  id: "checklist1",
  task_id: "task1",
  name: "Steps",
  resolved: 0,
  unresolved: 1,
  items: [],
};

describe("clickup tools", () => {
  beforeEach(() => {
    process.env.CLICKUP_API_TOKEN = "pk_test_token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKUP_API_TOKEN;
    delete process.env.CLICKUP_PERSONAL_TOKEN;
  });

  it("throws a clear error when no token is configured", () => {
    delete process.env.CLICKUP_API_TOKEN;

    expect(() => resolveClickUpToken()).toThrow(ClickUpAuthError);
    expect(() => resolveClickUpToken()).toThrow("CLICKUP_API_TOKEN");
  });

  it("accepts a per-request token override", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ teams: [team] }));

    await runTool(
      clickupWorkspaceTools.clickupListTeamsTool,
      {},
      {
        requestContext: {
          get: (key: string) => (key === "clickupAccessToken" ? "pk_override" : undefined),
        },
      } as never,
    );

    expect(calls[0].headers.get("authorization")).toBe("pk_override");
    expect(calls[0].url.pathname).toBe("/api/v2/team");
  });

  it("walks the workspace hierarchy", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith("/team")) return jsonResponse({ teams: [team] });
      if (url.pathname.endsWith("/space")) return jsonResponse({ spaces: [space] });
      if (url.pathname.endsWith("/folder")) return jsonResponse({ folders: [folder] });
      if (url.pathname.endsWith("/list")) return jsonResponse({ lists: [list] });
      if (url.pathname.match(/\/space\/[^/]+$/)) return jsonResponse(space);
      if (url.pathname.match(/\/folder\/[^/]+$/)) return jsonResponse(folder);
      if (url.pathname.match(/\/list\/[^/]+$/)) return jsonResponse(list);
      return jsonResponse({ error: "unexpected" }, 404);
    });

    const teams = await runTool(clickupWorkspaceTools.clickupListTeamsTool, {});
    expect(teams.teams).toEqual([team]);

    const spaces = await runTool(clickupWorkspaceTools.clickupListSpacesTool, {
      teamId: "90152648112",
      archived: false,
    });
    expect(spaces.spaces).toEqual([space]);
    expect(calls[1].url.searchParams.get("archived")).toBe("false");

    const oneSpace = await runTool(clickupWorkspaceTools.clickupGetSpaceTool, {
      spaceId: "space1",
    });
    expect(oneSpace.name).toBe("Team Space");

    const folders = await runTool(clickupWorkspaceTools.clickupListFoldersTool, {
      spaceId: "space1",
      archived: false,
    });
    expect(folders.folders).toEqual([folder]);

    const oneFolder = await runTool(clickupWorkspaceTools.clickupGetFolderTool, {
      folderId: "folder1",
      includeSubfolders: true,
    });
    expect(oneFolder.id).toBe("folder1");
    expect(calls[4].url.searchParams.get("include_subfolders")).toBe("true");

    const folderLists = await runTool(clickupWorkspaceTools.clickupListListsTool, {
      folderId: "folder1",
      archived: false,
    });
    expect(folderLists.lists).toEqual([list]);
    expect(calls[5].url.pathname).toBe("/api/v2/folder/folder1/list");

    const spaceLists = await runTool(clickupWorkspaceTools.clickupListListsTool, {
      spaceId: "space1",
      archived: true,
    });
    expect(spaceLists.lists).toEqual([list]);
    expect(calls[6].url.pathname).toBe("/api/v2/space/space1/list");
    expect(calls[6].url.searchParams.get("archived")).toBe("true");

    const oneList = await runTool(clickupWorkspaceTools.clickupGetListTool, {
      listId: "list1",
    });
    expect(oneList.name).toBe("Project 2");
  });

  it("lists tasks with filters and pagination", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ tasks: [task], last_page: true }),
    );

    const result = await runTool(clickupTaskTools.clickupListTasksTool, {
      listId: "list1",
      archived: false,
      page: 2,
      orderBy: "due_date",
      reverse: true,
      subtasks: false,
      statuses: ["to do", "in progress"],
      includeClosed: true,
      includeTiml: false,
      assignees: ["302682250"],
      watchers: [],
      tags: ["backend"],
      dueDateGt: 100,
      dueDateLt: 200,
      dateCreatedGt: 300,
      dateCreatedLt: 400,
      dateUpdatedGt: 500,
      dateUpdatedLt: 600,
      customFields: [{ field_id: "field1", operator: "=", value: "x" }],
      includeMarkdownDescription: true,
    });

    expect(result.tasks).toEqual([task]);
    expect(result.last_page).toBe(true);

    const call = calls[0];
    expect(call.url.pathname).toBe("/api/v2/list/list1/task");
    expect(call.url.searchParams.get("page")).toBe("2");
    expect(call.url.searchParams.get("order_by")).toBe("due_date");
    expect(call.url.searchParams.get("reverse")).toBe("true");
    expect(call.url.searchParams.get("include_closed")).toBe("true");
    expect(call.url.searchParams.getAll("statuses[]")).toEqual(["to do", "in progress"]);
    expect(call.url.searchParams.getAll("assignees[]")).toEqual(["302682250"]);
    expect(call.url.searchParams.getAll("tags[]")).toEqual(["backend"]);
    expect(call.url.searchParams.get("due_date_gt")).toBe("100");
    expect(call.url.searchParams.get("include_markdown_description")).toBe("true");
    expect(JSON.parse(call.url.searchParams.get("custom_fields") ?? "[]")).toEqual([
      { field_id: "field1", operator: "=", value: "x" },
    ]);
  });

  it("gets tasks by ID or custom ID", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(task));

    const result = await runTool(clickupTaskTools.clickupGetTaskTool, {
      taskId: "CUSTOM-1",
      customTaskIds: true,
      teamId: "90152648112",
      includeSubtasks: true,
      includeMarkdownDescription: true,
    });

    expect(result).toEqual(task);
    expect(calls[0].url.pathname).toBe("/api/v2/task/CUSTOM-1");
    expect(calls[0].url.searchParams.get("custom_task_ids")).toBe("true");
    expect(calls[0].url.searchParams.get("team_id")).toBe("90152648112");
    expect(calls[0].url.searchParams.get("include_subtasks")).toBe("true");
    expect(calls[0].url.searchParams.get("include_markdown_description")).toBe("true");
  });

  it("creates tasks with custom fields", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(task));

    const result = await runTool(clickupTaskTools.clickupCreateTaskTool, {
      listId: "list1",
      name: "Task 1",
      description: "Plain",
      markdownContent: "**Markdown**",
      status: "to do",
      priority: 2,
      assignees: [302682250],
      tags: ["backend"],
      dueDate: 1793000000000,
      dueDateTime: true,
      startDate: 1792000000000,
      startDateTime: false,
      timeEstimate: 3600000,
      points: 3,
      notifyAll: false,
      parent: "parent1",
      linksTo: "linked1",
      checkRequiredCustomFields: true,
      customFields: [{ id: "field1", value: "x" }],
    });

    expect(result).toEqual(task);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/api/v2/list/list1/task");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      name: "Task 1",
      description: "Plain",
      markdown_content: "**Markdown**",
      status: "to do",
      priority: 2,
      assignees: [302682250],
      tags: ["backend"],
      due_date: 1793000000000,
      due_date_time: true,
      start_date: 1792000000000,
      start_date_time: false,
      time_estimate: 3600000,
      points: 3,
      notify_all: false,
      parent: "parent1",
      links_to: "linked1",
      check_required_custom_fields: true,
      custom_fields: [{ id: "field1", value: "x" }],
    });
  });

  it("updates and deletes tasks", async () => {
    const { calls } = mockGoogleFetch(({ method }) =>
      method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(task),
    );

    await runTool(clickupTaskTools.clickupUpdateTaskTool, {
      taskId: "task1",
      name: "Renamed",
      status: "complete",
      priority: 1,
      assignees: { add: [302682250], rem: [] },
      watchers: { add: [1], rem: [2] },
      archived: false,
      customTaskIds: false,
    });

    const updateCall = calls[0];
    expect(updateCall.method).toBe("PUT");
    expect(updateCall.url.pathname).toBe("/api/v2/task/task1");
    expect(JSON.parse(updateCall.body ?? "{}")).toEqual({
      name: "Renamed",
      status: "complete",
      priority: 1,
      assignees: { add: [302682250], rem: [] },
      watchers: { add: [1], rem: [2] },
      archived: false,
    });

    const deleted = await runTool(clickupTaskTools.clickupDeleteTaskTool, {
      taskId: "CUSTOM-9",
      customTaskIds: true,
      teamId: "90152648112",
    });

    expect(deleted).toEqual({ taskId: "CUSTOM-9", deleted: true });
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url.searchParams.get("custom_task_ids")).toBe("true");
    expect(calls[1].url.searchParams.get("team_id")).toBe("90152648112");
  });

  it("manages task comments", async () => {
    const { calls } = mockGoogleFetch(({ method }) => {
      if (method === "GET") return jsonResponse({ comments: [comment] });
      if (method === "POST") {
        return jsonResponse({ id: "comment2", hist_id: "h1", date: 1792597300000 });
      }
      return jsonResponse({});
    });

    const listed = await runTool(clickupCommentTools.clickupListTaskCommentsTool, {
      taskId: "task1",
      start: 1792597300000,
      startId: "comment1",
      customTaskIds: false,
    });
    expect(listed.comments).toEqual([comment]);
    expect(calls[0].url.searchParams.get("start")).toBe("1792597300000");
    expect(calls[0].url.searchParams.get("start_id")).toBe("comment1");

    const created = await runTool(clickupCommentTools.clickupCreateTaskCommentTool, {
      taskId: "task1",
      commentText: "Hello",
      notifyAll: true,
      assignee: 302682250,
      customTaskIds: false,
    });
    expect(created).toEqual({ id: "comment2", hist_id: "h1", date: 1792597300000 });
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({
      comment_text: "Hello",
      notify_all: true,
      assignee: 302682250,
    });

    const updated = await runTool(clickupCommentTools.clickupUpdateCommentTool, {
      commentId: "comment1",
      commentText: "Edited",
      assignee: null,
      resolved: true,
    });
    expect(updated).toEqual({ success: true });
    expect(JSON.parse(calls[2].body ?? "{}")).toEqual({
      comment_text: "Edited",
      assignee: null,
      resolved: true,
    });

    const deleted = await runTool(clickupCommentTools.clickupDeleteCommentTool, {
      commentId: "comment1",
    });
    expect(deleted).toEqual({ commentId: "comment1", deleted: true });
  });

  it("tracks and lists time entries", async () => {
    const { calls } = mockGoogleFetch(({ method, url }) => {
      if (method === "GET" && url.pathname.endsWith("/time")) {
        return jsonResponse({ data: [{ user: { id: 1 }, time: 60000, intervals: [] }] });
      }
      if (method === "GET") return jsonResponse({ data: [timeEntry] });
      if (method === "POST") return jsonResponse({ data: timeEntry });
      if (method === "DELETE") return jsonResponse({ data: timeEntry });
      return jsonResponse({});
    });

    const taskTime = await runTool(clickupTimeTools.clickupGetTaskTimeTool, {
      taskId: "task1",
      customTaskIds: false,
    });
    expect(taskTime.data[0].time).toBe(60000);

    const entries = await runTool(clickupTimeTools.clickupListTimeEntriesTool, {
      teamId: "90152648112",
      startDate: 1792000000000,
      endDate: 1793000000000,
      assignee: 302682250,
      includeTaskTags: true,
      includeLocationNames: true,
      listId: "list1",
      isBillable: false,
      customTaskIds: false,
    });
    expect(entries.data).toEqual([timeEntry]);
    expect(calls[1].url.pathname).toBe("/api/v2/team/90152648112/time_entries");
    expect(calls[1].url.searchParams.get("assignee")).toBe("302682250");
    expect(calls[1].url.searchParams.get("list_id")).toBe("list1");
    expect(calls[1].url.searchParams.get("is_billable")).toBe("false");

    const created = await runTool(clickupTimeTools.clickupCreateTimeEntryTool, {
      teamId: "90152648112",
      start: 1792597300000,
      duration: 60000,
      description: "Work",
      billable: false,
      assignee: 302682250,
      taskId: "task1",
      customTaskIds: false,
    });
    expect(created).toEqual(timeEntry);
    expect(JSON.parse(calls[2].body ?? "{}")).toEqual({
      start: 1792597300000,
      duration: 60000,
      description: "Work",
      billable: false,
      assignee: 302682250,
      tid: "task1",
    });

    const updated = await runTool(clickupTimeTools.clickupUpdateTimeEntryTool, {
      teamId: "90152648112",
      timerId: "time1",
      start: 1792597300000,
      end: 1792597360000,
      description: "More work",
      tags: [{ name: "billable", tag_fg: "#000", tag_bg: "#fff" }],
      tagAction: "add",
      customTaskIds: false,
    });
    expect(updated).toEqual({ success: true });
    expect(JSON.parse(calls[3].body ?? "{}")).toEqual({
      start: 1792597300000,
      end: 1792597360000,
      description: "More work",
      tags: [{ name: "billable", tag_fg: "#000", tag_bg: "#fff" }],
      tag_action: "add",
    });

    const deleted = await runTool(clickupTimeTools.clickupDeleteTimeEntryTool, {
      teamId: "90152648112",
      timerId: "time1",
    });
    expect(deleted.timerId).toBe("time1");
    expect(deleted.deleted).toBe(true);
  });

  it("reads and sets custom fields", async () => {
    const field = {
      id: "field1",
      name: "Priority",
      type: "drop_down",
      type_config: { options: [] },
    };
    const { calls } = mockGoogleFetch(({ method }) => {
      if (method === "GET") return jsonResponse({ fields: [field] });
      return jsonResponse({});
    });

    const fields = await runTool(clickupFieldTools.clickupListCustomFieldsTool, {
      listId: "list1",
      includeAppliedObjects: true,
    });
    expect(fields.fields).toEqual([field]);
    expect(calls[0].url.searchParams.get("include_applied_objects")).toBe("true");

    const set = await runTool(clickupFieldTools.clickupSetCustomFieldTool, {
      taskId: "task1",
      fieldId: "field1",
      value: "option-uuid",
      valueOptions: { time: true },
      customTaskIds: false,
    });
    expect(set).toEqual({ taskId: "task1", fieldId: "field1", success: true });
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({
      value: "option-uuid",
      value_options: { time: true },
    });

    const removed = await runTool(clickupFieldTools.clickupRemoveCustomFieldTool, {
      taskId: "task1",
      fieldId: "field1",
      customTaskIds: false,
    });
    expect(removed).toEqual({ taskId: "task1", fieldId: "field1", removed: true });
    expect(calls[2].method).toBe("DELETE");
  });

  it("manages webhooks", async () => {
    const { calls } = mockGoogleFetch(({ method, url }) => {
      if (method === "GET") return jsonResponse({ webhooks: [webhook] });
      if (method === "DELETE") return jsonResponse({});
      return jsonResponse({ id: "wh1", webhook });
    });

    const listed = await runTool(clickupWebhookTools.clickupListWebhooksTool, {
      teamId: "90152648112",
    });
    expect(listed.webhooks).toEqual([webhook]);

    const created = await runTool(clickupWebhookTools.clickupCreateWebhookTool, {
      teamId: "90152648112",
      endpoint: "https://example.com/hook",
      events: ["taskCreated", "taskUpdated"],
      listId: "12345",
    });
    expect(created.id).toBe("wh1");
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({
      endpoint: "https://example.com/hook",
      events: ["taskCreated", "taskUpdated"],
      list_id: 12345,
    });

    const updated = await runTool(clickupWebhookTools.clickupUpdateWebhookTool, {
      webhookId: "wh1",
      endpoint: "https://example.com/hook",
      events: ["taskCreated"],
      status: "inactive",
    });
    expect(updated.id).toBe("wh1");
    expect(JSON.parse(calls[2].body ?? "{}")).toEqual({
      endpoint: "https://example.com/hook",
      events: ["taskCreated"],
      status: "inactive",
    });

    const deleted = await runTool(clickupWebhookTools.clickupDeleteWebhookTool, {
      webhookId: "wh1",
    });
    expect(deleted).toEqual({ webhookId: "wh1", deleted: true });
  });

  it("manages checklists and checklist items", async () => {
    const { calls } = mockGoogleFetch(({ method, url }) => {
      if (method === "DELETE") return jsonResponse({});
      if (method === "PUT" && url.pathname.includes("/checklist_item/")) {
        return jsonResponse({ checklist });
      }
      if (method === "POST" && url.pathname.endsWith("/checklist_item")) {
        return jsonResponse({ checklist });
      }
      if (method === "POST") return jsonResponse({ checklist });
      return jsonResponse({});
    });

    const created = await runTool(clickupChecklistTools.clickupCreateChecklistTool, {
      taskId: "task1",
      name: "Steps",
      customTaskIds: false,
    });
    expect(created.checklist).toEqual(checklist);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ name: "Steps" });

    const edited = await runTool(clickupChecklistTools.clickupEditChecklistTool, {
      checklistId: "checklist1",
      name: "Renamed",
      position: 0,
    });
    expect(edited).toEqual({ checklistId: "checklist1", updated: true });

    const item = await runTool(clickupChecklistTools.clickupCreateChecklistItemTool, {
      checklistId: "checklist1",
      name: "Step one",
      assignee: 302682250,
    });
    expect(item.checklist).toEqual(checklist);

    const itemEdited = await runTool(clickupChecklistTools.clickupEditChecklistItemTool, {
      checklistId: "checklist1",
      checklistItemId: "item1",
      name: "Step 1",
      resolved: true,
      parent: null,
    });
    expect(itemEdited.checklist).toEqual(checklist);
    expect(JSON.parse(calls[3].body ?? "{}")).toEqual({
      name: "Step 1",
      resolved: true,
      parent: null,
    });

    const itemDeleted = await runTool(clickupChecklistTools.clickupDeleteChecklistItemTool, {
      checklistId: "checklist1",
      checklistItemId: "item1",
    });
    expect(itemDeleted.deleted).toBe(true);

    const deleted = await runTool(clickupChecklistTools.clickupDeleteChecklistTool, {
      checklistId: "checklist1",
    });
    expect(deleted).toEqual({ checklistId: "checklist1", deleted: true });
    expect(calls[5].method).toBe("DELETE");
  });

  it("surfaces ClickUp API errors with the error code and status", async () => {
    mockGoogleFetch(() =>
      jsonResponse({ err: "Task not found", ECODE: "ITEM_014" }, 400),
    );

    const failure = runTool(clickupTaskTools.clickupGetTaskTool, {
      taskId: "missing",
      customTaskIds: false,
      includeSubtasks: false,
      includeMarkdownDescription: false,
    });

    await expect(failure).rejects.toThrow(ClickUpApiError);
    await expect(failure).rejects.toThrow("ITEM_014: Task not found");
  });

  it("validates mutually exclusive and dependent options", async () => {
    mockGoogleFetch(() => jsonResponse({}));

    await expect(
      runTool(clickupWorkspaceTools.clickupListListsTool, { archived: false }),
    ).rejects.toThrow("exactly one of folderId or spaceId");

    await expect(
      runTool(clickupTaskTools.clickupGetTaskTool, {
        taskId: "task1",
        customTaskIds: true,
        includeSubtasks: false,
        includeMarkdownDescription: false,
      }),
    ).rejects.toThrow("teamId is required");

    await expect(
      runTool(clickupTimeTools.clickupCreateTimeEntryTool, {
        teamId: "90152648112",
        start: 1792597300000,
        customTaskIds: false,
      }),
    ).rejects.toThrow("duration or end");

    await expect(
      runTool(clickupTimeTools.clickupUpdateTimeEntryTool, {
        teamId: "90152648112",
        timerId: "time1",
        start: 1792597300000,
        customTaskIds: false,
      }),
    ).rejects.toThrow("start and end");

    await expect(
      runTool(clickupTimeTools.clickupListTimeEntriesTool, {
        teamId: "90152648112",
        spaceId: "space1",
        listId: "list1",
        customTaskIds: false,
      }),
    ).rejects.toThrow("Only one of");

    await expect(
      runTool(clickupCommentTools.clickupListTaskCommentsTool, {
        taskId: "task1",
        start: 1792597300000,
        customTaskIds: false,
      }),
    ).rejects.toThrow("start and startId");
  });
});
