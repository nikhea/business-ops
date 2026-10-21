import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const timeTagSchema = z.object({
  name: z.string(),
  tag_fg: z.string().describe("Foreground color, e.g. #000000"),
  tag_bg: z.string().describe("Background color, e.g. #FFFFFF"),
});

const timeEntrySchema = z.looseObject({
  id: z.string().optional(),
  task: z.unknown().nullable().optional(),
  wid: z.string().optional(),
  user: z.unknown().optional(),
  billable: z.boolean().optional(),
  start: z.union([z.string(), z.number()]).optional(),
  end: z.union([z.string(), z.number()]).nullable().optional(),
  duration: z.union([z.string(), z.number()]).nullable().optional(),
  description: z.string().optional(),
  tags: z.array(z.unknown()).optional(),
  source: z.string().optional(),
  at: z.union([z.string(), z.number()]).optional(),
  approval_id: z.string().nullable().optional(),
  approval: z.unknown().nullable().optional(),
  task_location: z.unknown().optional(),
  task_tags: z.array(z.unknown()).nullable().optional(),
  task_url: z.string().nullable().optional(),
});

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  ) as Partial<T>;
}

function taskLookupQuery(customTaskIds?: boolean, teamId?: string) {
  return compact({
    custom_task_ids: customTaskIds,
    team_id: teamId,
  });
}

const taskTimeGroupSchema = z.looseObject({
  user: z.unknown().optional(),
  time: z.union([z.number(), z.string()]).optional(),
  intervals: z.array(z.unknown()).optional(),
});

export const clickupGetTaskTimeTool = createTool({
  id: "clickup_get_task_time",
  title: "ClickUp: get tracked time",
  description:
    "Get time tracked on a task, grouped by user with each tracked interval. This uses ClickUp's legacy task time endpoint.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({
    data: z.array(taskTimeGroupSchema),
  }),
  execute: async ({ taskId, customTaskIds, teamId }, { requestContext }) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<{ data?: z.infer<typeof taskTimeGroupSchema>[] }>(
      `/task/${encodeURIComponent(taskId)}/time`,
      {
        query: taskLookupQuery(customTaskIds, teamId),
        authContext: { requestContext },
      },
    ).then((result) => ({
      data: result.data ?? [],
    }));
  },
});

export const clickupListTimeEntriesTool = createTool({
  id: "clickup_list_time_entries",
  title: "ClickUp: list time entries",
  description:
    "List time entries in a Workspace within a date range. Filter by assignee and one location (space, folder, list, or task). Defaults to the last 30 days for the authenticated user.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
    startDate: z.number().int().optional().describe("Range start (Unix ms)"),
    endDate: z.number().int().optional().describe("Range end (Unix ms)"),
    assignee: z.number().int().optional().describe("User ID; omit for the authenticated user"),
    includeTaskTags: z.boolean().optional().describe("Include task tags"),
    includeLocationNames: z.boolean().optional().describe("Include task location names"),
    spaceId: z.string().optional().describe("Filter by Space"),
    folderId: z.string().optional().describe("Filter by Folder"),
    listId: z.string().optional().describe("Filter by List"),
    taskId: z.string().optional().describe("Filter by task"),
    isBillable: z.boolean().optional().describe("Filter billable/non-billable entries"),
    customTaskIds: z.boolean().default(false).describe("Interpret taskId as a custom task ID"),
  }),
  outputSchema: z.object({
    data: z.array(timeEntrySchema),
  }),
  execute: async (
    {
      teamId,
      startDate,
      endDate,
      assignee,
      includeTaskTags,
      includeLocationNames,
      spaceId,
      folderId,
      listId,
      taskId,
      isBillable,
      customTaskIds,
    },
    { requestContext },
  ) => {
    const locations = [spaceId, folderId, listId, taskId].filter(Boolean);
    if (locations.length > 1) {
      throw new Error("Only one of spaceId, folderId, listId, or taskId may be provided.");
    }

    return clickupRequest<{ data?: z.infer<typeof timeEntrySchema>[] }>(
      `/team/${encodeURIComponent(teamId)}/time_entries`,
      {
        query: compact({
          start_date: startDate,
          end_date: endDate,
          assignee,
          include_task_tags: includeTaskTags,
          include_location_names: includeLocationNames,
          space_id: spaceId,
          folder_id: folderId,
          list_id: listId,
          task_id: taskId,
          is_billable: isBillable,
          ...taskLookupQuery(customTaskIds, teamId),
        }),
        authContext: { requestContext },
      },
    ).then((result) => ({ data: result.data ?? [] }));
  },
});

export const clickupCreateTimeEntryTool = createTool({
  id: "clickup_create_time_entry",
  title: "ClickUp: create time entry",
  description:
    "Create a ClickUp time entry. Provide `start` and either `duration` (ms) or `end` (Unix ms). Optionally attach it to a task with `taskId`.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
    start: z.number().int().describe("Start time (Unix ms)"),
    duration: z.number().int().optional().describe("Duration in milliseconds"),
    end: z.number().int().optional().describe("End time (Unix ms); alternative to duration"),
    description: z.string().optional().describe("What was worked on"),
    billable: z.boolean().optional().describe("Mark the entry billable"),
    assignee: z.number().int().optional().describe("User ID for the entry"),
    taskId: z.string().optional().describe("Task ID to attach the entry to"),
    tags: z.array(timeTagSchema).optional().describe("Time entry tags"),
    customTaskIds: z.boolean().default(false).describe("Interpret taskId as a custom task ID"),
  }),
  outputSchema: timeEntrySchema,
  execute: async (
    {
      teamId,
      start,
      duration,
      end,
      description,
      billable,
      assignee,
      taskId,
      tags,
      customTaskIds,
    },
    { requestContext },
  ) => {
    if (duration === undefined && end === undefined) {
      throw new Error("Provide either duration or end.");
    }
    if (customTaskIds && taskId === undefined) {
      throw new Error("taskId is required when customTaskIds is true.");
    }

    const result = await clickupRequest<Record<string, unknown>>(
      `/team/${encodeURIComponent(teamId)}/time_entries`,
      {
        method: "POST",
        query: taskLookupQuery(customTaskIds, teamId),
        json: compact({
          start,
          duration,
          end,
          description,
          billable,
          assignee,
          tid: taskId,
          tags,
        }),
        authContext: { requestContext },
      },
    );

    const entry = (result.data ?? result) as z.infer<typeof timeEntrySchema>;
    if (!entry.id) {
      throw new Error("ClickUp did not return the created time entry.");
    }

    return entry;
  },
});

export const clickupUpdateTimeEntryTool = createTool({
  id: "clickup_update_time_entry",
  title: "ClickUp: update time entry",
  description:
    "Update a ClickUp time entry's times, description, billable state, task, or tags. Use `tagAction` to add, remove, or replace tags.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
    timerId: z.string().describe("Time entry ID"),
    start: z.number().int().optional().describe("Start time (Unix ms); requires end"),
    end: z.number().int().optional().describe("End time (Unix ms); requires start"),
    duration: z.number().int().optional().describe("Duration in milliseconds"),
    description: z.string().optional().describe("New description"),
    billable: z.boolean().optional().describe("Billable state"),
    taskId: z.string().optional().describe("Task ID to associate"),
    tags: z.array(timeTagSchema).optional().describe("Tags for the tag action"),
    tagAction: z
      .enum(["replace", "add", "remove"])
      .optional()
      .describe("How to apply tags; required when tags are provided"),
    customTaskIds: z.boolean().default(false).describe("Interpret taskId as a custom task ID"),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async (
    {
      teamId,
      timerId,
      start,
      end,
      duration,
      description,
      billable,
      taskId,
      tags,
      tagAction,
      customTaskIds,
    },
    { requestContext },
  ) => {
    if ((start === undefined) !== (end === undefined)) {
      throw new Error("start and end must be provided together.");
    }
    if (tags && !tagAction) {
      throw new Error("tagAction is required when tags are provided.");
    }

    await clickupRequest(
      `/team/${encodeURIComponent(teamId)}/time_entries/${encodeURIComponent(timerId)}`,
      {
        method: "PUT",
        query: taskLookupQuery(customTaskIds, teamId),
        json: compact({
          start,
          end,
          duration,
          description,
          billable,
          tid: taskId,
          tags,
          tag_action: tagAction,
        }),
        authContext: { requestContext },
      },
    );

    return { success: true };
  },
});

export const clickupDeleteTimeEntryTool = createTool({
  id: "clickup_delete_time_entry",
  title: "ClickUp: delete time entry",
  description: "Delete a ClickUp time entry.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace ID"),
    timerId: z.string().describe("Time entry ID"),
  }),
  outputSchema: z.object({
    timerId: z.string(),
    deleted: z.boolean(),
    data: z.unknown().optional(),
  }),
  execute: async ({ teamId, timerId }, { requestContext }) => {
    const result = await clickupRequest<{ data?: unknown }>(
      `/team/${encodeURIComponent(teamId)}/time_entries/${encodeURIComponent(timerId)}`,
      {
        method: "DELETE",
        authContext: { requestContext },
      },
    );

    return { timerId, deleted: true, data: result?.data };
  },
});

export const clickupTimeTools = {
  clickupGetTaskTimeTool,
  clickupListTimeEntriesTool,
  clickupCreateTimeEntryTool,
  clickupUpdateTimeEntryTool,
  clickupDeleteTimeEntryTool,
};
