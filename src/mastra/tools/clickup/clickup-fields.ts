import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const customFieldSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  type_config: z.unknown().optional(),
  date_created: z.string().optional(),
  hide_from_guests: z.boolean().optional(),
  applied_objects: z.array(z.unknown()).optional(),
  required: z.boolean().optional(),
});

function taskLookupQuery(customTaskIds?: boolean, teamId?: string) {
  return {
    ...(customTaskIds ? { custom_task_ids: true } : {}),
    ...(teamId ? { team_id: teamId } : {}),
  };
}

export const clickupListCustomFieldsTool = createTool({
  id: "clickup_list_custom_fields",
  title: "ClickUp: list custom fields",
  description:
    "List the Custom Fields available in a ClickUp List, including each field's type and configuration.",
  inputSchema: z.object({
    listId: z.string().describe("List ID"),
    includeAppliedObjects: z
      .boolean()
      .default(false)
      .describe("Include applied_objects for task-type-scoped fields"),
  }),
  outputSchema: z.object({
    fields: z.array(customFieldSchema),
  }),
  execute: async ({ listId, includeAppliedObjects }, { requestContext }) => {
    return clickupRequest<{ fields?: z.infer<typeof customFieldSchema>[] }>(
      `/list/${encodeURIComponent(listId)}/field`,
      {
        query: { include_applied_objects: includeAppliedObjects },
        authContext: { requestContext },
      },
    ).then((result) => ({ fields: result.fields ?? [] }));
  },
});

export const clickupSetCustomFieldTool = createTool({
  id: "clickup_set_custom_field",
  title: "ClickUp: set custom field value",
  description:
    "Set a Custom Field value on a ClickUp task. The `value` shape depends on the field type (string, number, array, object, or null).",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    fieldId: z.string().describe("Custom Field ID (UUID)"),
    value: z
      .unknown()
      .describe("Field value; use null to clear, arrays/objects for relationship or label fields"),
    valueOptions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Extra options, e.g. { time: true } for date fields"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    fieldId: z.string(),
    success: z.boolean(),
  }),
  execute: async (
    { taskId, fieldId, value, valueOptions, customTaskIds, teamId },
    { requestContext },
  ) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    await clickupRequest(
      `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`,
      {
        method: "POST",
        query: taskLookupQuery(customTaskIds, teamId),
        json: {
          value,
          ...(valueOptions !== undefined ? { value_options: valueOptions } : {}),
        },
        authContext: { requestContext },
      },
    );

    return { taskId, fieldId, success: true };
  },
});

export const clickupRemoveCustomFieldTool = createTool({
  id: "clickup_remove_custom_field",
  title: "ClickUp: remove custom field value",
  description: "Clear a Custom Field value from a ClickUp task.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    fieldId: z.string().describe("Custom Field ID (UUID)"),
    customTaskIds: z.boolean().default(false).describe("Treat taskId as a custom task ID"),
    teamId: z.string().optional().describe("Workspace ID; required with customTaskIds"),
  }),
  outputSchema: z.object({
    taskId: z.string(),
    fieldId: z.string(),
    removed: z.boolean(),
  }),
  execute: async ({ taskId, fieldId, customTaskIds, teamId }, { requestContext }) => {
    if (customTaskIds && !teamId) {
      throw new Error("teamId is required when customTaskIds is true.");
    }

    await clickupRequest(
      `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`,
      {
        method: "DELETE",
        query: taskLookupQuery(customTaskIds, teamId),
        authContext: { requestContext },
      },
    );

    return { taskId, fieldId, removed: true };
  },
});

export const clickupFieldTools = {
  clickupListCustomFieldsTool,
  clickupSetCustomFieldTool,
  clickupRemoveCustomFieldTool,
};
