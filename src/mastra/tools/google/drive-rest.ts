import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { googleFetch, googleRequest, type GoogleToolContext } from "./google-auth";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

const FILE_FIELDS =
  "id,name,mimeType,modifiedTime,createdTime,size,webViewLink,parents,trashed,owners(emailAddress,displayName)";

const GOOGLE_DOC_MIME_PREFIX = "application/vnd.google-apps.";

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  owners?: { emailAddress?: string; displayName?: string }[];
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

const driveFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  modifiedTime: z.string().optional(),
  createdTime: z.string().optional(),
  size: z.string().optional(),
  webViewLink: z.string().optional(),
  parents: z.array(z.string()).optional(),
  trashed: z.boolean().optional(),
  owners: z
    .array(
      z.object({
        emailAddress: z.string().optional(),
        displayName: z.string().optional(),
      }),
    )
    .optional(),
});

function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isTextMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml")
  );
}

function exportMimeTypeFor(mimeType?: string): string {
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text/csv";
  return "text/plain";
}

function isGoogleNativeDoc(mimeType?: string): boolean {
  return Boolean(mimeType?.startsWith(GOOGLE_DOC_MIME_PREFIX));
}

function googleFormatFor(mimeType: string): string | undefined {
  if (mimeType === "text/plain" || mimeType === "text/html") {
    return "application/vnd.google-apps.document";
  }
  if (
    mimeType === "text/csv" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "application/vnd.google-apps.spreadsheet";
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "application/vnd.google-apps.presentation";
  }
  return undefined;
}

async function fetchFileMetadata(fileId: string, context: GoogleToolContext): Promise<DriveFile> {
  return googleRequest<DriveFile>(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
    query: { fields: FILE_FIELDS, supportsAllDrives: true },
    authContext: context,
  });
}

interface ReadFileResult {
  file: DriveFile;
  content?: string;
  contentBase64?: string;
  truncated: boolean;
  sizeBytes: number;
}

async function readFileContent(
  fileId: string,
  maxBytes: number,
  context: GoogleToolContext,
): Promise<ReadFileResult> {
  const file = await fetchFileMetadata(fileId, context);
  const googleDoc = isGoogleNativeDoc(file.mimeType);

  const response = googleDoc
    ? await googleFetch(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export`, {
        query: { mimeType: exportMimeTypeFor(file.mimeType) },
        authContext: context,
      })
    : await googleFetch(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
        query: { alt: "media", supportsAllDrives: true },
        authContext: context,
      });

  const buffer = Buffer.from(await response.arrayBuffer());
  const truncated = buffer.byteLength > maxBytes;
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
  const asText = googleDoc || isTextMimeType(file.mimeType);

  return {
    file,
    content: asText ? slice.toString("utf8") : undefined,
    contentBase64: asText ? undefined : slice.toString("base64"),
    truncated,
    sizeBytes: buffer.byteLength,
  };
}

export const driveSearchFilesTool = createTool({
  id: "drive_search_files",
  title: "Drive: search files",
  description:
    "Search Google Drive with Drive query syntax, for example `name contains 'invoice' and mimeType = 'application/pdf'`. Results exclude trashed files unless the query says otherwise.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Drive search query; defaults to all non-trashed files"),
    folderId: z.string().optional().describe("Restrict results to a folder ID"),
    pageSize: z.number().int().min(1).max(100).default(20).describe("Maximum files to return"),
    orderBy: z.string().default("modifiedTime desc").describe("Sort order, e.g. `name`, `modifiedTime desc`"),
    pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  }),
  outputSchema: z.object({
    files: z.array(driveFileSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ query, folderId, pageSize, orderBy, pageToken }, { requestContext }) => {
    const clauses: string[] = [query?.trim() || "trashed = false"];

    if (folderId) {
      clauses.push(`'${escapeQueryValue(folderId)}' in parents`);
    }

    const response = await googleRequest<DriveListResponse>(`${DRIVE_BASE}/files`, {
      query: {
        q: clauses.join(" and "),
        pageSize,
        orderBy,
        pageToken,
        fields: `files(${FILE_FIELDS}),nextPageToken`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      authContext: { requestContext },
    });

    return { files: response.files ?? [], nextPageToken: response.nextPageToken };
  },
});

export const driveListFolderTool = createTool({
  id: "drive_list_folder",
  title: "Drive: list folder",
  description: "List the direct children of a Drive folder. Defaults to the root of My Drive.",
  inputSchema: z.object({
    folderId: z.string().default("root").describe("Folder ID; `root` is the top of My Drive"),
    pageSize: z.number().int().min(1).max(100).default(25).describe("Maximum files to return"),
    pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  }),
  outputSchema: z.object({
    files: z.array(driveFileSchema),
    nextPageToken: z.string().optional(),
  }),
  execute: async ({ folderId, pageSize, pageToken }, { requestContext }) => {
    const response = await googleRequest<DriveListResponse>(`${DRIVE_BASE}/files`, {
      query: {
        q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
        pageSize,
        orderBy: "folder,name",
        pageToken,
        fields: `files(${FILE_FIELDS}),nextPageToken`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      authContext: { requestContext },
    });

    return { files: response.files ?? [], nextPageToken: response.nextPageToken };
  },
});

export const driveGetFileTool = createTool({
  id: "drive_get_file",
  title: "Drive: get file",
  description:
    "Get metadata for a Drive file by ID. Set `includeContent` to also return the text content of Google Docs/Sheets/Slides or plain-text files.",
  inputSchema: z.object({
    fileId: z.string().describe("Drive file ID"),
    includeContent: z.boolean().default(false).describe("Also read the file content (text)"),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(1_000_000)
      .describe("Maximum bytes of content to read when includeContent is true"),
  }),
  outputSchema: z.object({
    file: driveFileSchema,
    content: z.string().optional(),
    truncated: z.boolean().optional(),
  }),
  execute: async ({ fileId, includeContent, maxBytes }, { requestContext }) => {
    const context: GoogleToolContext = { requestContext };

    if (!includeContent) {
      return { file: await fetchFileMetadata(fileId, context) };
    }

    const result = await readFileContent(fileId, maxBytes, context);

    return {
      file: result.file,
      content: result.content ?? result.contentBase64,
      truncated: result.truncated,
    };
  },
});

export const driveReadFileTool = createTool({
  id: "drive_read_file",
  title: "Drive: read file content",
  description:
    "Read the contents of a Drive file. Text-like files return UTF-8 text; binaries return base64. Google Docs, Sheets and Slides are exported as text.",
  inputSchema: z.object({
    fileId: z.string().describe("Drive file ID"),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(1_000_000)
      .describe("Maximum number of bytes to read"),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    content: z.string().optional(),
    contentBase64: z.string().optional(),
    truncated: z.boolean(),
    sizeBytes: z.number(),
  }),
  execute: async ({ fileId, maxBytes }, { requestContext }) => {
    const result = await readFileContent(fileId, maxBytes, { requestContext });

    return {
      id: result.file.id,
      name: result.file.name,
      mimeType: result.file.mimeType,
      content: result.content,
      contentBase64: result.contentBase64,
      truncated: result.truncated,
      sizeBytes: result.sizeBytes,
    };
  },
});

export const driveUploadFileTool = createTool({
  id: "drive_upload_file",
  title: "Drive: upload file",
  description:
    "Upload a new file to Drive from text or base64 content. Use `convertToGoogleFormat` to turn documents/sheets into native Google formats.",
  inputSchema: z.object({
    name: z.string().describe("File name, including extension"),
    content: z.string().describe("File content: plain text, or base64 when `contentBase64` is true"),
    contentBase64: z.boolean().default(false).describe("Treat `content` as base64-encoded binary data"),
    mimeType: z.string().default("text/plain").describe("MIME type of the content"),
    parentFolderId: z.string().optional().describe("Folder to upload into; defaults to My Drive root"),
    convertToGoogleFormat: z
      .boolean()
      .default(false)
      .describe("Convert uploads into native Google Docs/Sheets/Slides format"),
  }),
  outputSchema: driveFileSchema,
  execute: async (
    { name, content, contentBase64, mimeType, parentFolderId, convertToGoogleFormat },
    { requestContext },
  ) => {
    const metadata: Record<string, unknown> = { name };
    const targetMimeType = convertToGoogleFormat ? (googleFormatFor(mimeType) ?? mimeType) : mimeType;
    metadata.mimeType = targetMimeType;
    if (parentFolderId) metadata.parents = [parentFolderId];

    const data = contentBase64 ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
    const boundary = `mastra_${randomUUID()}`;

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        "utf8",
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
        "utf8",
      ),
      Buffer.from(data.toString("base64"), "utf8"),
      Buffer.from(`\r\n--${boundary}--`, "utf8"),
    ]);

    return googleRequest<DriveFile>(`${DRIVE_UPLOAD_BASE}/files`, {
      method: "POST",
      query: {
        uploadType: "multipart",
        supportsAllDrives: true,
        fields: FILE_FIELDS,
      },
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
      authContext: { requestContext },
    });
  },
});

export const driveCreateFolderTool = createTool({
  id: "drive_create_folder",
  title: "Drive: create folder",
  description: "Create a new folder in Drive, optionally inside an existing folder.",
  inputSchema: z.object({
    name: z.string().describe("Folder name"),
    parentFolderId: z.string().optional().describe("Parent folder ID; defaults to My Drive root"),
  }),
  outputSchema: driveFileSchema,
  execute: async ({ name, parentFolderId }, { requestContext }) => {
    const body: Record<string, unknown> = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentFolderId) body.parents = [parentFolderId];

    return googleRequest<DriveFile>(`${DRIVE_BASE}/files`, {
      method: "POST",
      query: { fields: FILE_FIELDS, supportsAllDrives: true },
      json: body,
      authContext: { requestContext },
    });
  },
});

export const driveShareFileTool = createTool({
  id: "drive_share_file",
  title: "Drive: share file",
  description:
    "Grant access to a Drive file or folder. Use `type: 'user'` or `'group'` with an email, `'domain'` with a domain, or `'anyone'` for a public link.",
  inputSchema: z.object({
    fileId: z.string().describe("Drive file or folder ID"),
    role: z.enum(["reader", "commenter", "writer", "fileOrganizer", "organizer"]).describe("Permission level"),
    type: z.enum(["user", "group", "domain", "anyone"]).describe("Grantee type"),
    emailAddress: z.string().optional().describe("Required for `user` and `group`"),
    domain: z.string().optional().describe("Required for `domain`"),
    sendNotificationEmail: z.boolean().default(true).describe("Email the grantee about the share"),
  }),
  outputSchema: z.object({
    permissionId: z.string().optional(),
    role: z.string().optional(),
    type: z.string().optional(),
    shared: z.boolean(),
  }),
  execute: async (
    { fileId, role, type, emailAddress, domain, sendNotificationEmail },
    { requestContext },
  ) => {
    if ((type === "user" || type === "group") && !emailAddress) {
      throw new Error(`An emailAddress is required when sharing with type "${type}".`);
    }
    if (type === "domain" && !domain) {
      throw new Error('A domain is required when sharing with type "domain".');
    }

    const body: Record<string, unknown> = { role, type };
    if (emailAddress) body.emailAddress = emailAddress;
    if (domain) body.domain = domain;

    const permission = await googleRequest<{ id?: string; role?: string; type?: string }>(
      `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/permissions`,
      {
        method: "POST",
        query: { sendNotificationEmail, supportsAllDrives: true, fields: "id,role,type" },
        json: body,
        authContext: { requestContext },
      },
    );

    return {
      permissionId: permission.id,
      role: permission.role,
      type: permission.type,
      shared: true,
    };
  },
});

export const driveDeleteFileTool = createTool({
  id: "drive_delete_file",
  title: "Drive: delete file",
  description:
    "Move a file to the trash, or permanently delete it with `permanent: true`. Prefer trashing unless the user explicitly asks for permanent deletion.",
  inputSchema: z.object({
    fileId: z.string().describe("Drive file ID"),
    permanent: z.boolean().default(false).describe("Permanently delete instead of trashing"),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    deleted: z.boolean(),
    permanent: z.boolean(),
  }),
  execute: async ({ fileId, permanent }, { requestContext }) => {
    if (permanent) {
      await googleRequest<void>(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        query: { supportsAllDrives: true },
        authContext: { requestContext },
      });
    } else {
      await googleRequest<DriveFile>(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
        method: "PATCH",
        query: { fields: "id,trashed", supportsAllDrives: true },
        json: { trashed: true },
        authContext: { requestContext },
      });
    }

    return { fileId, deleted: true, permanent };
  },
});

export const driveTools = {
  driveSearchFilesTool,
  driveListFolderTool,
  driveGetFileTool,
  driveReadFileTool,
  driveUploadFileTool,
  driveCreateFolderTool,
  driveShareFileTool,
  driveDeleteFileTool,
};
