import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const statusSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string(),
  color: z.string().optional(),
  orderindex: z.union([z.number(), z.string()]).optional(),
  type: z.string().optional(),
});

export const taskSchema = z.looseObject({
  id: z.string(),
  custom_id: z.string().nullable().optional(),
  custom_item_id: z.number().nullable().optional(),
  name: z.string(),
  text_content: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  markdown_description: z.string().optional(),
  status: statusSchema.optional(),
  orderindex: z.union([z.string(), z.number()]).optional(),
  date_created: z.string().optional(),
  date_updated: z.string().optional(),
  date_closed: z.string().nullable().optional(),
  date_done: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  creator: z.unknown().optional(),
  assignees: z.array(z.unknown()).optional(),
  group_assignees: z.array(z.unknown()).optional(),
  watchers: z.array(z.unknown()).optional(),
  checklists: z.array(z.unknown()).optional(),
  tags: z.array(z.unknown()).optional(),
  parent: z.string().nullable().optional(),
  top_level_parent: z.string().nullable().optional(),
  priority: z.unknown().nullable().optional(),
  due_date: z.union([z.string(), z.number()]).nullable().optional(),
  start_date: z.union([z.string(), z.number()]).nullable().optional(),
  points: z.number().nullable().optional(),
  time_estimate: z.union([z.string(), z.number()]).nullable().optional(),
  time_spent: z.number().nullable().optional(),
  custom_fields: z.array(z.unknown()).optional(),
  dependencies: z.array(z.unknown()).optional(),
  linked_tasks: z.array(z.unknown()).optional(),
  locations: z.array(z.unknown()).optional(),
  team_id: z.string().optional(),
  url: z.string().optional(),
  sharing: z.unknown().optional(),
  permission_level: z.string().optional(),
  list: z.unknown().optional(),
  project: z.unknown().optional(),
  folder: z.unknown().optional(),
  space: z.unknown().optional(),
});

const customFieldValueSchema = z.object({
  id: z.string().describe("Custom Field ID"),
  value: z
    .unknown()
    .describe("Value appropriate for the field type (string, number, array, object, or null)"),
  value_options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Extra options, e.g. { time: true } for date fields"),
});

const assigneeChangeSchema = z.object({
  add: z.array(z.number().int()).default([]).describe("User IDs to add"),
  rem: z.array(z.number().int()).default([]).describe("User IDs to remove"),
});

const groupAssigneeChangeSchema = z.object({
  add: z.array(z.string()).default([]).describe("Group IDs to add"),
  rem: z.array(z.string()).default([]).describe("Group IDs to remove"),
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

export const clickupListTasksTool = createTool({
  id: "clickup_list_tasks",
  title: "ClickUp: list tasks",
  description:
    "List tasks in a ClickUp List. Supports status, assignee, tag, date, and custom-field filters plus pagination (100 tasks per page).",
  inputSchema: z.object({
    listId: z.string().describe("List ID"),
    archived: z.boolean().default(false).describe("Include archived tasks"),
    page: z.number().int().min(0).default(0).describe("Page number, starting at 0"),
    orderBy: z
      .enum(["id", "created", "updated", "due_date"])
      .optional()
      .describe("Sort field"),
    reverse: z.boolean().default(false).describe("Reverse the sort order"),
    subtasks: z.boolean().default(false).describe("Include subtasks"),
    statuses: z.array(z.string()).optional().describe("Filter by status names"),
    includeClosed: z.boolean().default(false).describe("Include closed tasks"),
    includeTiml: z
      .boolean()
      .default(false)
      .describe("Include tasks added to this list from another home list"),
    assignees: z.array(z.string()).optional().describe("Filter by assignee user IDs"),
    watchers: z.array(z.string()).optional().describe("Filter by watcher user IDs"),
    tags: z.array(z.string()).optional().describe("Filter by tag names"),
    dueDateGt: z.number().int().optional().describe("Due date after (Unix ms)"),
    dueDateLt: z.number().int().optional().describe("Due date before (Unix ms)"),
    dateCreatedGt: z.number().int().optional().describe("Created after (Unix ms)"),
    dateCreatedLt: z.number().int().optional().describe("Created before (Unix ms)"),
    dateUpdatedGt: z.number().int().optional().describe("Updated after (Unix ms)"),
    dateUpdatedLt: z.number().int().optional().describe("Updated before (Unix ms)"),
    customFields: z
      .array(
        z.object({
          field_id: z.string(),
          operator: z.string().describe("Comparison operator, e.g. =, <, >, IS NOT NULL"),
          value: z.unknown().optional(),
        }),
      )
      .optional()
      .describe("Custom Field filters"),
    includeMarkdownDescription: z
      .boolean()
      .default(false)
      .describe("Return markdown_description too"),
  }),
  outputSchema: z.object({
    tasks: z.array(taskSchema),
    last_page: z.boolean().optional(),
  }),
  execute: async (
    {
      listId,
      archived,
      page,
      orderBy,
      reverse,
      subtasks,
      statuses,
      includeClosed,
      includeTiml,
      assignees,
      watchers,
      tags,
      dueDateGt,
      dueDateLt,
      dateCreatedGt,
      dateCreatedLt,
      dateUpdatedGt,
      dateUpdatedLt,
      customFields,
      includeMarkdownDescription,
    },
    { requestContext },
  ) => {
    const query: Record<string, unknown> = compact({
      archived,
      page,
      order_by: orderBy,
      reverse,
      subtasks,
      include_closed: includeClosed,
      include_timl: includeTiml,
      due_date_gt: dueDateGt,
      due_date_lt: dueDateLt,
      date_created_gt: dateCreatedGt,
      date_created_lt: dateCreatedLt,
      date_updated_gt: dateUpdatedGt,
      date_updated_lt: dateUpdatedLt,
      include_markdown_description: includeMarkdownDescription,
      "statuses[]": statuses,
      "assignees[]": assignees,
      "watchers[]": watchers,
      "tags[]": tags,
      custom_fields: customFields ? JSON.stringify(customFields) : undefined,
    });

    return clickupRequest<{
      tasks?: z.infer<typeof taskSchema>[];
      last_page?: boolean;
    }>(`/list/${encodeURIComponent(listId)}/task`, {
      query,
      authContext: { requestContext },
    }).then((result) => ({
      tasks: result.tasks ?? [],
      last_page: result.last_page,
    }));
  },
});

export const clickupGetTaskTool = createTool({
  id: "clickup_get_task",
  title: "ClickUp: get task",
  description:
    "Get a ClickUp task by ID, optionally including subtasks and the markdown description. Set `customTaskIds` when using a custom task ID.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID or custom task ID"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
    includeSubtasks: z.boolean().default(false).describe("Include subtasks"),
    includeMarkdownDescription: z
      .boolean()
      .default(false)
      .describe("Include markdown_description"),
  }),
  outputSchema: taskSchema,
  execute: async (
    { taskId, customTaskIds, teamId, includeSubtasks, includeMarkdownDescription },
    { requestContext },
  ) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<z.infer<typeof taskSchema>>(
      `/task/${encodeURIComponent(taskId)}`,
      {
        query: compact({
          ...taskLookupQuery(customTaskIds, teamId),
          include_subtasks: includeSubtasks,
          include_markdown_description: includeMarkdownDescription,
        }),
        authContext: { requestContext },
      },
    );
  },
});

export const clickupCreateTaskTool = createTool({
  id: "clickup_create_task",
  title: "ClickUp: create task",
  description:
    "Create a task in a ClickUp List. Supports status, priority (1 urgent to 4 low), assignees, tags, dates, estimates, subtasks, and custom fields.",
  inputSchema: z.object({
    listId: z.string().describe("List ID"),
    name: z.string().describe("Task name"),
    description: z.string().optional().describe("Plain-text description"),
    markdownContent: z.string().optional().describe("Markdown description (overrides description)"),
    status: z.string().optional().describe("Status name, e.g. 'in progress'"),
    priority: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("1 urgent, 2 high, 3 normal, 4 low"),
    assignees: z.array(z.number().int()).optional().describe("Assignee user IDs"),
    tags: z.array(z.string()).optional().describe("Tag names"),
    dueDate: z.number().int().optional().describe("Due date (Unix ms)"),
    dueDateTime: z.boolean().optional().describe("Due date includes a time"),
    startDate: z.number().int().optional().describe("Start date (Unix ms)"),
    startDateTime: z.boolean().optional().describe("Start date includes a time"),
    timeEstimate: z.number().int().optional().describe("Time estimate (ms)"),
    points: z.number().optional().describe("Sprint points"),
    notifyAll: z.boolean().default(false).describe("Also notify the task creator"),
    parent: z.string().optional().describe("Parent task ID to create a subtask"),
    linksTo: z.string().optional().describe("Task ID to link as a dependency"),
    checkRequiredCustomFields: z
      .boolean()
      .default(false)
      .describe("Enforce required Custom Fields"),
    customFields: z.array(customFieldValueSchema).optional().describe("Custom Field values"),
  }),
  outputSchema: taskSchema,
  execute: async (
    {
      listId,
      name,
      description,
      markdownContent,
      status,
      priority,
      assignees,
      tags,
      dueDate,
      dueDateTime,
      startDate,
      startDateTime,
      timeEstimate,
      points,
      notifyAll,
      parent,
      linksTo,
      checkRequiredCustomFields,
      customFields,
    },
    { requestContext },
  ) => {
    return clickupRequest<z.infer<typeof taskSchema>>(
      `/list/${encodeURIComponent(listId)}/task`,
      {
        method: "POST",
        json: compact({
          name,
          description,
          markdown_content: markdownContent,
          status,
          priority,
          assignees,
          tags,
          due_date: dueDate,
          due_date_time: dueDateTime,
          start_date: startDate,
          start_date_time: startDateTime,
          time_estimate: timeEstimate,
          points,
          notify_all: notifyAll,
          parent,
          links_to: linksTo,
          check_required_custom_fields: checkRequiredCustomFields,
          custom_fields: customFields,
        }),
        authContext: { requestContext },
      },
    );
  },
});

export const clickupUpdateTaskTool = createTool({
  id: "clickup_update_task",
  title: "ClickUp: update task",
  description:
    "Update a ClickUp task. Only supplied fields change. Assignees, group assignees, and watchers use add/remove lists.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    name: z.string().optional().describe("New task name"),
    description: z.string().optional().describe("New plain-text description"),
    markdownContent: z.string().optional().describe("New markdown description"),
    status: z.string().optional().describe("New status name"),
    priority: z.number().int().min(1).max(4).optional().describe("1 urgent to 4 low"),
    dueDate: z.number().int().optional().describe("Due date (Unix ms)"),
    dueDateTime: z.boolean().optional().describe("Due date includes a time"),
    startDate: z.number().int().optional().describe("Start date (Unix ms)"),
    startDateTime: z.boolean().optional().describe("Start date includes a time"),
    timeEstimate: z.number().int().optional().describe("Time estimate (ms)"),
    points: z.number().optional().describe("Sprint points"),
    parent: z.string().optional().describe("Move a subtask under another parent task"),
    assignees: assigneeChangeSchema.optional(),
    groupAssignees: groupAssigneeChangeSchema.optional(),
    watchers: assigneeChangeSchema.optional(),
    archived: z.boolean().optional().describe("Archive or unarchive the task"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: taskSchema,
  execute: async (
    {
      taskId,
      name,
      description,
      markdownContent,
      status,
      priority,
      dueDate,
      dueDateTime,
      startDate,
      startDateTime,
      timeEstimate,
      points,
      parent,
      assignees,
      groupAssignees,
      watchers,
      archived,
      customTaskIds,
      teamId,
    },
    { requestContext },
  ) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    return clickupRequest<z.infer<typeof taskSchema>>(
      `/task/${encodeURIComponent(taskId)}`,
      {
        method: "PUT",
        query: taskLookupQuery(customTaskIds, teamId),
        json: compact({
          name,
          description,
          markdown_content: markdownContent,
          status,
          priority,
          due_date: dueDate,
          due_date_time: dueDateTime,
          start_date: startDate,
          start_date_time: startDateTime,
          time_estimate: timeEstimate,
          points,
          parent,
          assignees,
          group_assignees: groupAssignees,
          watchers,
          archived,
        }),
        authContext: { requestContext },
      },
    );
  },
});

export const clickupDeleteTaskTool = createTool({
  id: "clickup_delete_task",
  title: "ClickUp: delete task",
  description: "Delete a ClickUp task permanently.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    deleted: z.boolean(),
  }),
  execute: async ({ taskId, customTaskIds, teamId }, { requestContext }) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    await clickupRequest(`/task/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      query: taskLookupQuery(customTaskIds, teamId),
      authContext: { requestContext },
    });

    return { taskId, deleted: true };
  },
});

export const clickupTaskTools = {
  clickupListTasksTool,
  clickupGetTaskTool,
  clickupCreateTaskTool,
  clickupUpdateTaskTool,
  clickupDeleteTaskTool,
};
