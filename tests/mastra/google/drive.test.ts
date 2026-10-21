import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch, textResponse } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-redis";
import { runTool } from "../../helpers/tool";
import { driveTools } from "../../../src/mastra/tools/google/drive-rest";

vi.mock("../../../src/mastra/tools/google/google-redis", () => import("../../helpers/fake-google-redis"));

const context = { requestContext: { get: () => undefined } } as never;

const fileFields = {
  id: "f1",
  name: "notes.txt",
  mimeType: "text/plain",
  size: "5",
  modifiedTime: "2026-10-20T10:00:00.000Z",
};

describe("drive tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches with Drive query syntax and folder scoping", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ files: [fileFields], nextPageToken: "next" }),
    );

    const result = await runTool(driveTools.driveSearchFilesTool, 
      { query: "name contains 'notes'", folderId: "folder-1", pageSize: 5, orderBy: "name" },
      context,
    );

    expect(result.files).toEqual([fileFields]);
    expect(result.nextPageToken).toBe("next");

    const call = calls[0];
    expect(call.url.pathname).toBe("/drive/v3/files");
    expect(call.url.searchParams.get("q")).toBe("name contains 'notes' and 'folder-1' in parents");
    expect(call.url.searchParams.get("pageSize")).toBe("5");
    expect(call.url.searchParams.get("orderBy")).toBe("name");
    expect(call.url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(call.url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
  });

  it("lists the root folder by default", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ files: [] }));

    await runTool(driveTools.driveListFolderTool, { pageSize: 10 }, context);

    expect(calls[0].url.searchParams.get("q")).toBe("'root' in parents and trashed = false");
  });

  it("reads text content and truncates binary content", async () => {
    mockGoogleFetch(({ url }) => {
      if (url.searchParams.get("alt") === "media") {
        return textResponse("0123456789");
      }
      return jsonResponse({ ...fileFields, mimeType: "application/pdf" });
    });

    const result = await runTool(driveTools.driveReadFileTool, 
      { fileId: "f1", maxBytes: 4 },
      context,
    );

    expect(result.truncated).toBe(true);
    expect(result.sizeBytes).toBe(10);
    expect(result.content).toBeUndefined();
    expect(result.contentBase64).toBe(Buffer.from("0123").toString("base64"));
  });

  it("returns text for Google Docs exports", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith("/export")) {
        return textResponse("exported text");
      }
      return jsonResponse({ id: "doc1", name: "Doc", mimeType: "application/vnd.google-apps.document" });
    });

    const result = await runTool(driveTools.driveReadFileTool, { fileId: "doc1", maxBytes: 1000 }, context);

    expect(result.content).toBe("exported text");
    expect(calls.some((call) => call.url.pathname === "/drive/v3/files/doc1/export")).toBe(true);
    expect(calls.find((call) => call.url.pathname.endsWith("/export"))?.url.searchParams.get("mimeType")).toBe(
      "text/plain",
    );
  });

  it("uploads files as multipart and converts to Google formats", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ id: "new1", name: "upload.txt", mimeType: "text/plain" }),
    );

    await runTool(driveTools.driveUploadFileTool, 
      {
        name: "upload.txt",
        content: "hello",
        contentBase64: false,
        mimeType: "text/plain",
        convertToGoogleFormat: true,
      },
      context,
    );

    const uploadCall = calls[0];
    expect(uploadCall.url.pathname).toBe("/upload/drive/v3/files");
    expect(uploadCall.url.searchParams.get("uploadType")).toBe("multipart");
    expect(uploadCall.headers.get("content-type")).toMatch(/^multipart\/related; boundary=mastra_/);

    const body = uploadCall.body ?? "";
    expect(body).toContain('"name":"upload.txt"');
    expect(body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(body).toContain(Buffer.from("hello").toString("base64"));
  });

  it("creates folders", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ id: "folder1", name: "Test", mimeType: "application/vnd.google-apps.folder" }),
    );

    const folder = await runTool(driveTools.driveCreateFolderTool, 
      { name: "Test", parentFolderId: "parent1" },
      context,
    );

    expect(folder.id).toBe("folder1");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      name: "Test",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["parent1"],
    });
  });

  it("validates share grantees and posts permissions", async () => {
    await expect(
      runTool(driveTools.driveShareFileTool, 
        { fileId: "f1", role: "reader", type: "user", sendNotificationEmail: false },
        context,
      ),
    ).rejects.toThrow('An emailAddress is required when sharing with type "user".');

    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ id: "perm1", role: "reader", type: "anyone" }),
    );

    const result = await runTool(driveTools.driveShareFileTool, 
      { fileId: "f1", role: "reader", type: "anyone", sendNotificationEmail: false },
      context,
    );

    expect(result).toEqual({ permissionId: "perm1", role: "reader", type: "anyone", shared: true });
    expect(calls[0].url.searchParams.get("sendNotificationEmail")).toBe("false");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ role: "reader", type: "anyone" });
  });

  it("trashes by default and permanently deletes on request", async () => {
    const trashCalls = mockGoogleFetch(() => jsonResponse({ id: "f1", trashed: true }));
    await runTool(driveTools.driveDeleteFileTool, { fileId: "f1", permanent: false }, context);
    expect(trashCalls.calls[0].method).toBe("PATCH");
    expect(JSON.parse(trashCalls.calls[0].body ?? "{}")).toEqual({ trashed: true });

    vi.unstubAllGlobals();

    const deleteCalls = mockGoogleFetch(() => new Response(null, { status: 204 }));
    await runTool(driveTools.driveDeleteFileTool, { fileId: "f1", permanent: true }, context);
    expect(deleteCalls.calls[0].method).toBe("DELETE");

    expect(deleteCalls.calls[0].url.pathname).toBe("/drive/v3/files/f1");
  });
});
