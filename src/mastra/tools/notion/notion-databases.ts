import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  normalizeParent,
  notionObjectSchema,
  parentInputSchema,
  richText,
  type NotionObject,
} from "./notion-shared";
import { notionRequest } from "./notion-auth";

export const notionGetDatabaseTool = createTool({
  id: "notion_get_database",
  title: "Notion: get database",
  description:
    "Retrieve a database and its child data source IDs. Use a data source ID to query rows or " +
    "create pages.",
  inputSchema: z.object({
    databaseId: z.string().describe("Notion database ID"),
  }),
  outputSchema: notionObjectSchema,
  execute: async ({ databaseId }, { requestContext }) => {
    return notionRequest<NotionObject>(
      `/databases/${encodeURIComponent(databaseId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const notionCreateDatabaseTool = createTool({
  id: "notion_create_database",
  title: "Notion: create database",
  description:
    "Create a database and its first data source under a page or at the workspace level. " +
    "Pass `initialDataSourceProperties` for a custom schema or `databaseType` for Notion's " +
    "canonical tasks/projects/skills schema.",
  inputSchema: z.object({
    parent: parentInputSchema,
    title: z.string().optional().describe("Database title"),
    description: z.string().optional().describe("Database description"),
    isInline: z.boolean().optional().describe("Display the database inline in the parent page"),
    initialDataSourceProperties: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Property schema for the database's initial data source"),
    databaseType: z
      .enum(["tasks", "projects", "skills"])
      .optional()
      .describe("Create a typed database with Notion's canonical schema"),
    icon: z.unknown().optional().describe("Notion icon object"),
    cover: z.unknown().optional().describe("Notion cover object"),
    showDataSourceTitle: z
      .boolean()
      .optional()
      .describe("Show the data source title above the database's views"),
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    {
      parent,
      title,
      description,
      isInline,
      initialDataSourceProperties,
      databaseType,
      icon,
      cover,
      showDataSourceTitle,
    },
    { requestContext },
  ) => {
    if (databaseType !== undefined && initialDataSourceProperties !== undefined) {
      throw new Error("databaseType and initialDataSourceProperties cannot both be provided.");
    }

    return notionRequest<NotionObject>("/databases", {
      method: "POST",
      json: {
        parent: normalizeParent(parent, ["page_id", "workspace"]),
        ...(title !== undefined ? { title: richText(title) } : {}),
        ...(description !== undefined ? { description: richText(description) } : {}),
        ...(isInline !== undefined ? { is_inline: isInline } : {}),
        ...(initialDataSourceProperties !== undefined
          ? { initial_data_source: { properties: initialDataSourceProperties } }
          : {}),
        ...(databaseType !== undefined ? { database_type: databaseType } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(cover !== undefined ? { cover } : {}),
        ...(showDataSourceTitle !== undefined
          ? { show_data_source_title: showDataSourceTitle }
          : {}),
      },
      authContext: { requestContext },
    });
  },
});

export const notionUpdateDatabaseTool = createTool({
  id: "notion_update_database",
  title: "Notion: update database",
  description:
    "Update a database's title, description, parent, icon, cover, lock state, or trash state. " +
    "To change the schema or properties, update its data source instead.",
  inputSchema: z.object({
    databaseId: z.string().describe("Notion database ID"),
    parent: parentInputSchema.optional().describe("Move the database to a page or workspace"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    isInline: z.boolean().optional().describe("Display the database inline in its parent"),
    icon: z.unknown().optional().describe("Notion icon object"),
    cover: z.unknown().optional().describe("Notion cover object"),
    inTrash: z.boolean().optional().describe("Move the database to or from the trash"),
    isLocked: z.boolean().optional().describe("Lock or unlock the database in the Notion UI"),
    showDataSourceTitle: z
      .boolean()
      .optional()
      .describe("Show the data source title above the database's views"),
  }),
  outputSchema: notionObjectSchema,
  execute: async (
    {
      databaseId,
      parent,
      title,
      description,
      isInline,
      icon,
      cover,
      inTrash,
      isLocked,
      showDataSourceTitle,
    },
    { requestContext },
  ) => {
    const body: Record<string, unknown> = {
      ...(parent !== undefined
        ? { parent: normalizeParent(parent, ["page_id", "workspace"]) }
        : {}),
      ...(title !== undefined ? { title: richText(title) } : {}),
      ...(description !== undefined ? { description: richText(description) } : {}),
      ...(isInline !== undefined ? { is_inline: isInline } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(cover !== undefined ? { cover } : {}),
      ...(inTrash !== undefined ? { in_trash: inTrash } : {}),
      ...(isLocked !== undefined ? { is_locked: isLocked } : {}),
      ...(showDataSourceTitle !== undefined
        ? { show_data_source_title: showDataSourceTitle }
        : {}),
    };

    if (Object.keys(body).length === 0) {
      throw new Error("Provide at least one database field to update.");
    }

    return notionRequest<NotionObject>(`/databases/${encodeURIComponent(databaseId)}`, {
      method: "PATCH",
      json: body,
      authContext: { requestContext },
    });
  },
});

export const notionDatabaseTools = {
  notionGetDatabaseTool,
  notionCreateDatabaseTool,
  notionUpdateDatabaseTool,
};
