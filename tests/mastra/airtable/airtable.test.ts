import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { runTool } from "../../helpers/tool";
import {
  AirtableAuthError,
  AirtableApiError,
  resolveAirtableToken,
} from "../../../src/mastra/tools/airtable/airtable-auth";
import { airtableMetaTools } from "../../../src/mastra/tools/airtable/airtable-meta";
import { airtableRecordTools } from "../../../src/mastra/tools/airtable/airtable-records";
import { airtableCommentTools } from "../../../src/mastra/tools/airtable/airtable-comments";
import { airtableWebhookTools } from "../../../src/mastra/tools/airtable/airtable-webhooks";

const record = {
  id: "rec1",
  createdTime: "2026-10-20T10:00:00.000Z",
  fields: { Name: "Union Square", Visited: true },
};

describe("airtable tools", () => {
  beforeEach(() => {
    process.env.AIRTABLE_PAT = "test-pat";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AIRTABLE_PAT;
    delete process.env.AIRTABLE_API_KEY;
    delete process.env.AIRTABLE_ACCESS_TOKEN;
  });

  it("throws a clear error when no token is configured", async () => {
    delete process.env.AIRTABLE_PAT;

    await expect(() => resolveAirtableToken()).toThrow(AirtableAuthError);
    await expect(() => resolveAirtableToken()).toThrow("AIRTABLE_PAT");
  });

  it("accepts a per-request token override", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ bases: [] }));

    await runTool(
      airtableMetaTools.airtableListBasesTool,
      {},
      {
        requestContext: {
          get: (key: string) => (key === "airtableAccessToken" ? "pat-override" : undefined),
        },
      } as never,
    );

    expect(calls[0].headers.get("authorization")).toBe("Bearer pat-override");
  });

  it("lists bases with the environment token", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        bases: [
          { id: "app1", name: "Project Tracker", permissionLevel: "edit" },
          { id: "app2", name: "CRM", permissionLevel: "read" },
        ],
        offset: "itr123/app2",
      }),
    );

    const result = await runTool(airtableMetaTools.airtableListBasesTool, {
      offset: "itr123/app1",
    });

    expect(result.bases).toEqual([
      { id: "app1", name: "Project Tracker", permissionLevel: "edit" },
      { id: "app2", name: "CRM", permissionLevel: "read" },
    ]);
    expect(result.offset).toBe("itr123/app2");
    expect(calls[0].url.pathname).toBe("/v0/meta/bases");
    expect(calls[0].url.searchParams.get("offset")).toBe("itr123/app1");
    expect(calls[0].headers.get("authorization")).toBe("Bearer test-pat");
  });

  it("returns the base schema with fields and views", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        tables: [
          {
            id: "tbl1",
            name: "Contacts",
            description: "People",
            primaryFieldId: "fld1",
            fields: [
              { id: "fld1", name: "Name", type: "singleLineText" },
              {
                id: "fld2",
                name: "Status",
                type: "singleSelect",
                options: { choices: [{ name: "Open" }] },
              },
            ],
            views: [{ id: "viw1", name: "Grid view", type: "grid", visibleFieldIds: ["fld1"] }],
          },
        ],
      }),
    );

    const result = await runTool(airtableMetaTools.airtableListTablesTool, {
      baseId: "app1",
      includeVisibleFieldIds: true,
    });

    expect(calls[0].url.pathname).toBe("/v0/meta/bases/app1/tables");
    expect(calls[0].url.searchParams.getAll("include[]")).toEqual(["visibleFieldIds"]);

    expect(result.tables[0]).toMatchObject({
      id: "tbl1",
      name: "Contacts",
      primaryFieldId: "fld1",
      views: [{ id: "viw1", name: "Grid view", type: "grid", visibleFieldIds: ["fld1"] }],
    });
    expect(result.tables[0].fields[1]).toEqual({
      id: "fld2",
      name: "Status",
      type: "singleSelect",
      options: { choices: [{ name: "Open" }] },
    });
  });

  it("lists records with filters, sorting, views, and field selection", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ records: [record], offset: "itr-next" }),
    );

    const result = await runTool(airtableRecordTools.airtableListRecordsTool, {
      baseId: "app1",
      table: "My Table",
      pageSize: 50,
      fetchAll: false,
      view: "Grid view",
      filterByFormula: "{Status} = 'Open'",
      sort: [{ field: "Name", direction: "desc" }],
      fields: ["Name", "Status"],
      returnFieldsByFieldId: true,
    });

    expect(result.records).toEqual([record]);
    expect(result.offset).toBe("itr-next");
    expect(result.fetchedAll).toBe(false);

    const call = calls[0];
    expect(call.url.pathname).toBe("/v0/app1/My%20Table");
    expect(call.url.searchParams.get("pageSize")).toBe("50");
    expect(call.url.searchParams.get("view")).toBe("Grid view");
    expect(call.url.searchParams.get("filterByFormula")).toBe("{Status} = 'Open'");
    expect(call.url.searchParams.get("sort[0][field]")).toBe("Name");
    expect(call.url.searchParams.get("sort[0][direction]")).toBe("desc");
    expect(call.url.searchParams.getAll("fields[]")).toEqual(["Name", "Status"]);
    expect(call.url.searchParams.get("returnFieldsByFieldId")).toBe("true");
  });

  it("follows pagination when fetchAll is enabled", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (!url.searchParams.get("offset")) {
        return jsonResponse({
          records: [{ id: "rec1", fields: { Name: "One" } }],
          offset: "off1",
        });
      }

      return jsonResponse({ records: [{ id: "rec2", fields: { Name: "Two" } }] });
    });

    const result = await runTool(airtableRecordTools.airtableListRecordsTool, {
      baseId: "app1",
      table: "tbl1",
      pageSize: 1,
      fetchAll: true,
    });

    expect(result.records.map((item: { id: string }) => item.id)).toEqual(["rec1", "rec2"]);
    expect(result.fetchedAll).toBe(true);
    expect(result.offset).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].url.searchParams.get("offset")).toBe("off1");
  });

  it("gets a single record", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse(record));

    const result = await runTool(airtableRecordTools.airtableGetRecordTool, {
      baseId: "app1",
      table: "tbl1",
      recordId: "rec1",
    });

    expect(result).toEqual(record);
    expect(calls[0].url.pathname).toBe("/v0/app1/tbl1/rec1");
  });

  it("creates records in a batch", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ records: [record], details: { message: "partialSuccess", reasons: [] } }),
    );

    const result = await runTool(airtableRecordTools.airtableCreateRecordsTool, {
      baseId: "app1",
      table: "tbl1",
      records: [{ fields: { Name: "Union Square" } }, { fields: { Name: "Ferry Building" } }],
      typecast: true,
      returnFieldsByFieldId: false,
    });

    expect(result.records).toEqual([record]);
    expect(result.details?.message).toBe("partialSuccess");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v0/app1/tbl1");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      records: [{ fields: { Name: "Union Square" } }, { fields: { Name: "Ferry Building" } }],
      typecast: true,
      returnFieldsByFieldId: false,
    });
  });

  it("patches records and supports upserts", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ records: [record], createdRecords: ["rec2"], updatedRecords: ["rec1"] }),
    );

    const result = await runTool(airtableRecordTools.airtableUpdateRecordsTool, {
      baseId: "app1",
      table: "tbl1",
      records: [{ fields: { Name: "Twin Peaks" } }],
      performUpsert: { fieldsToMergeOn: ["Name"] },
      typecast: false,
      returnFieldsByFieldId: false,
    });

    expect(calls[0].method).toBe("PATCH");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      records: [{ fields: { Name: "Twin Peaks" } }],
      performUpsert: { fieldsToMergeOn: ["Name"] },
      typecast: false,
      returnFieldsByFieldId: false,
    });
    expect(result.createdRecords).toEqual(["rec2"]);
    expect(result.updatedRecords).toEqual(["rec1"]);
  });

  it("rejects updates without ids unless upserting", async () => {
    mockGoogleFetch(() => jsonResponse({ records: [] }));

    await expect(
      runTool(airtableRecordTools.airtableUpdateRecordsTool, {
        baseId: "app1",
        table: "tbl1",
        records: [{ fields: { Name: "No ID" } }],
        typecast: false,
        returnFieldsByFieldId: false,
      }),
    ).rejects.toThrow("Every record needs an id unless performUpsert is set.");
  });

  it("replaces records with PUT", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ records: [record] }));

    await runTool(airtableRecordTools.airtableReplaceRecordsTool, {
      baseId: "app1",
      table: "tbl1",
      records: [{ id: "rec1", fields: { Name: "Union Square" } }],
      typecast: false,
      returnFieldsByFieldId: false,
    });

    expect(calls[0].method).toBe("PUT");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      records: [{ id: "rec1", fields: { Name: "Union Square" } }],
      typecast: false,
      returnFieldsByFieldId: false,
    });
  });

  it("deletes records by id", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        records: [
          { id: "rec1", deleted: true },
          { id: "rec2", deleted: true },
        ],
      }),
    );

    const result = await runTool(airtableRecordTools.airtableDeleteRecordsTool, {
      baseId: "app1",
      table: "tbl1",
      recordIds: ["rec1", "rec2"],
    });

    expect(result.records).toHaveLength(2);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.searchParams.getAll("records[]")).toEqual(["rec1", "rec2"]);
  });

  it("surfaces Airtable API errors with type and status", async () => {
    mockGoogleFetch(() =>
      jsonResponse(
        { error: { type: "INVALID_REQUEST", message: "Could not find table tbl404" } },
        422,
      ),
    );

    const failure = runTool(airtableMetaTools.airtableListTablesTool, {
      baseId: "app1",
      includeVisibleFieldIds: false,
    });

    await expect(failure).rejects.toThrow(AirtableApiError);
    await expect(failure).rejects.toThrow("INVALID_REQUEST: Could not find table tbl404");
  });

  it("lists comments and creates, updates, and deletes them", async () => {
    const comment = {
      id: "com1",
      createdTime: "2026-10-20T10:00:00.000Z",
      lastUpdatedTime: null,
      text: "Hello",
      author: { id: "usr1", email: "ada@example.com", name: "Ada" },
    };

    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET") {
        return jsonResponse({ comments: [comment], offset: null });
      }
      if (method === "POST") {
        return jsonResponse(comment);
      }
      if (method === "PATCH") {
        return jsonResponse({ ...comment, text: "Updated", lastUpdatedTime: "2026-10-21T10:00:00.000Z" });
      }
      if (method === "DELETE") {
        return jsonResponse({ id: "com1", deleted: true });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const listed = await runTool(airtableCommentTools.airtableListCommentsTool, {
      baseId: "app1",
      table: "tbl1",
      recordId: "rec1",
      pageSize: 100,
    });
    expect(listed.comments).toEqual([comment]);
    expect(calls[0].url.pathname).toBe("/v0/app1/tbl1/rec1/comments");

    await runTool(airtableCommentTools.airtableCreateCommentTool, {
      baseId: "app1",
      table: "tbl1",
      recordId: "rec1",
      text: "Hello",
      parentCommentId: "com0",
    });
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({ text: "Hello", parentCommentId: "com0" });

    const updated = await runTool(airtableCommentTools.airtableUpdateCommentTool, {
      baseId: "app1",
      table: "tbl1",
      recordId: "rec1",
      commentId: "com1",
      text: "Updated",
    });
    expect(updated.text).toBe("Updated");

    const deleted = await runTool(airtableCommentTools.airtableDeleteCommentTool, {
      baseId: "app1",
      table: "tbl1",
      recordId: "rec1",
      commentId: "com1",
    });
    expect(deleted).toEqual({ id: "com1", deleted: true });
    expect(calls[3].method).toBe("DELETE");
  });

  it("manages webhooks and polls payloads", async () => {
    const webhook = {
      id: "ach1",
      areNotificationsEnabled: true,
      cursorForNextPayload: 3,
      isHookEnabled: true,
      notificationUrl: "https://example.com/hook",
      expirationTime: "2026-10-28T10:00:00.000Z",
      lastSuccessfulNotificationTime: null,
      specification: { options: { filters: { dataTypes: ["tableData"] } } },
      lastNotificationResult: null,
    };

    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET" && url.pathname.endsWith("/webhooks")) {
        return jsonResponse({ webhooks: [webhook] });
      }
      if (method === "GET" && url.pathname.endsWith("/payloads")) {
        return jsonResponse({
          cursor: 5,
          mightHaveMore: false,
          payloads: [{ baseTransactionNumber: 4 }],
        });
      }
      if (method === "POST" && url.pathname.endsWith("/refresh")) {
        return jsonResponse({ expirationTime: "2026-11-04T10:00:00.000Z" });
      }
      if (method === "POST") {
        return jsonResponse({
          id: "ach2",
          macSecretBase64: "secret",
          expirationTime: "2026-10-28T10:00:00.000Z",
        });
      }
      if (method === "DELETE") {
        return jsonResponse({});
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const listed = await runTool(airtableWebhookTools.airtableListWebhooksTool, { baseId: "app1" });
    expect(listed.webhooks[0]).toMatchObject({ id: "ach1", isHookEnabled: true });

    const created = await runTool(airtableWebhookTools.airtableCreateWebhookTool, {
      baseId: "app1",
      notificationUrl: "https://example.com/hook",
      dataTypes: ["tableData"],
      recordChangeScope: "tbl1",
      includeCellValuesInFieldIds: "all",
      includePreviousCellValues: true,
    });
    expect(created).toEqual({
      id: "ach2",
      macSecretBase64: "secret",
      expirationTime: "2026-10-28T10:00:00.000Z",
    });
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({
      notificationUrl: "https://example.com/hook",
      specification: {
        options: {
          filters: {
            dataTypes: ["tableData"],
            recordChangeScope: "tbl1",
            includeCellValuesInFieldIds: "all",
            includePreviousCellValues: true,
          },
        },
      },
    });

    const refreshed = await runTool(airtableWebhookTools.airtableRefreshWebhookTool, {
      baseId: "app1",
      webhookId: "ach2",
    });
    expect(refreshed.expirationTime).toBe("2026-11-04T10:00:00.000Z");

    const payloads = await runTool(airtableWebhookTools.airtableListWebhookPayloadsTool, {
      baseId: "app1",
      webhookId: "ach2",
      cursor: 4,
      limit: 50,
    });
    expect(payloads.cursor).toBe(5);
    expect(payloads.payloads).toEqual([{ baseTransactionNumber: 4 }]);
    expect(calls[3].url.searchParams.get("cursor")).toBe("4");

    const deleted = await runTool(airtableWebhookTools.airtableDeleteWebhookTool, {
      baseId: "app1",
      webhookId: "ach2",
    });
    expect(deleted).toEqual({ webhookId: "ach2", deleted: true });
    expect(calls[4].method).toBe("DELETE");
  });
});
