import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { clickupRequest } from "./clickup-auth";

const identifierSchema = z.union([z.string(), z.number()]);

const userSchema = z.looseObject({
  id: identifierSchema.optional(),
  username: z.string().optional(),
  email: z.string().optional(),
  initials: z.string().optional(),
  color: z.string().optional(),
  profilePicture: z.string().nullable().optional(),
  role: identifierSchema.optional(),
  role_key: z.string().optional(),
});

const statusSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string(),
  color: z.string().optional(),
  orderindex: z.union([z.number(), z.string()]).optional(),
  type: z.string().optional(),
});

export const teamSchema = z.looseObject({
  id: identifierSchema,
  name: z.string(),
  color: z.string().optional(),
  avatar: z.string().nullable().optional(),
  members: z.array(z.looseObject({ user: userSchema })).optional(),
});

export const spaceSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  private: z.boolean().optional(),
  color: z.string().optional(),
  avatar: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  admin_can_manage: z.boolean().optional(),
  statuses: z.array(statusSchema).optional(),
  multiple_assignees: z.boolean().optional(),
  features: z.unknown().optional(),
  members: z.array(z.unknown()).optional(),
});

export const folderSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  orderindex: z.union([z.number(), z.string()]).optional(),
  override_statuses: z.boolean().optional(),
  hidden: z.boolean().optional(),
  archived: z.boolean().optional(),
  task_count: z.union([z.string(), z.number()]).optional(),
  space: z.unknown().optional(),
  statuses: z.array(statusSchema).optional(),
  lists: z.array(z.unknown()).optional(),
  permission_level: z.string().optional(),
  parent_folder: z.string().optional(),
  folders: z.array(z.unknown()).optional(),
});

export const listSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  orderindex: z.union([z.number(), z.string()]).optional(),
  content: z.string().optional(),
  task_count: z.union([z.string(), z.number()]).nullable().optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  override_statuses: z.boolean().optional(),
  statuses: z.array(statusSchema).optional(),
  space: z.unknown().optional(),
  folder: z.unknown().optional(),
  permission_level: z.string().optional(),
});

export const clickupListTeamsTool = createTool({
  id: "clickup_list_teams",
  title: "ClickUp: list workspaces",
  description:
    "List the ClickUp Workspaces (teams) the token can access, including members and their roles.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    teams: z.array(teamSchema),
  }),
  execute: async (_input, { requestContext }) => {
    return clickupRequest<{ teams: z.infer<typeof teamSchema>[] }>("/team", {
      authContext: { requestContext },
    });
  },
});

export const clickupListSpacesTool = createTool({
  id: "clickup_list_spaces",
  title: "ClickUp: list spaces",
  description: "List the Spaces in a ClickUp Workspace.",
  inputSchema: z.object({
    teamId: z.string().describe("Workspace (team) ID"),
    archived: z.boolean().default(false).describe("Include archived Spaces"),
  }),
  outputSchema: z.object({
    spaces: z.array(spaceSchema),
  }),
  execute: async ({ teamId, archived }, { requestContext }) => {
    return clickupRequest<{ spaces: z.infer<typeof spaceSchema>[] }>(
      `/team/${encodeURIComponent(teamId)}/space`,
      {
        query: { archived },
        authContext: { requestContext },
      },
    );
  },
});

export const clickupGetSpaceTool = createTool({
  id: "clickup_get_space",
  title: "ClickUp: get space",
  description: "Get a ClickUp Space, including statuses and enabled features.",
  inputSchema: z.object({
    spaceId: z.string().describe("Space ID"),
  }),
  outputSchema: spaceSchema,
  execute: async ({ spaceId }, { requestContext }) => {
    return clickupRequest<z.infer<typeof spaceSchema>>(
      `/space/${encodeURIComponent(spaceId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const clickupListFoldersTool = createTool({
  id: "clickup_list_folders",
  title: "ClickUp: list folders",
  description: "List the Folders in a ClickUp Space.",
  inputSchema: z.object({
    spaceId: z.string().describe("Space ID"),
    archived: z.boolean().default(false).describe("Include archived Folders"),
  }),
  outputSchema: z.object({
    folders: z.array(folderSchema),
  }),
  execute: async ({ spaceId, archived }, { requestContext }) => {
    return clickupRequest<{ folders: z.infer<typeof folderSchema>[] }>(
      `/space/${encodeURIComponent(spaceId)}/folder`,
      {
        query: { archived },
        authContext: { requestContext },
      },
    );
  },
});

export const clickupGetFolderTool = createTool({
  id: "clickup_get_folder",
  title: "ClickUp: get folder",
  description:
    "Get a ClickUp Folder. Set `includeSubfolders` to return the nested subfolder tree.",
  inputSchema: z.object({
    folderId: z.string().describe("Folder ID"),
    includeSubfolders: z.boolean().default(false).describe("Include nested subfolders"),
  }),
  outputSchema: folderSchema,
  execute: async ({ folderId, includeSubfolders }, { requestContext }) => {
    return clickupRequest<z.infer<typeof folderSchema>>(
      `/folder/${encodeURIComponent(folderId)}`,
      {
        query: { include_subfolders: includeSubfolders },
        authContext: { requestContext },
      },
    );
  },
});

export const clickupListListsTool = createTool({
  id: "clickup_list_lists",
  title: "ClickUp: list lists",
  description:
    "List Lists in a ClickUp Folder (`folderId`) or the folderless Lists in a Space (`spaceId`). Provide exactly one.",
  inputSchema: z.object({
    folderId: z.string().optional().describe("Folder ID; mutually exclusive with spaceId"),
    spaceId: z.string().optional().describe("Space ID for folderless Lists"),
    archived: z.boolean().default(false).describe("Include archived Lists"),
  }),
  outputSchema: z.object({
    lists: z.array(listSchema),
  }),
  execute: async ({ folderId, spaceId, archived }, { requestContext }) => {
    if ((folderId && spaceId) || (!folderId && !spaceId)) {
      throw new Error("Provide exactly one of folderId or spaceId.");
    }

    const path = folderId
      ? `/folder/${encodeURIComponent(folderId)}/list`
      : `/space/${encodeURIComponent(spaceId!)}/list`;

    return clickupRequest<{ lists: z.infer<typeof listSchema>[] }>(path, {
      query: { archived },
      authContext: { requestContext },
    });
  },
});

export const clickupGetListTool = createTool({
  id: "clickup_get_list",
  title: "ClickUp: get list",
  description: "Get a ClickUp List, including task count, statuses, and parent Space.",
  inputSchema: z.object({
    listId: z.string().describe("List ID"),
  }),
  outputSchema: listSchema,
  execute: async ({ listId }, { requestContext }) => {
    return clickupRequest<z.infer<typeof listSchema>>(
      `/list/${encodeURIComponent(listId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const clickupWorkspaceTools = {
  clickupListTeamsTool,
  clickupListSpacesTool,
  clickupGetSpaceTool,
  clickupListFoldersTool,
  clickupGetFolderTool,
  clickupListListsTool,
  clickupGetListTool,
};
