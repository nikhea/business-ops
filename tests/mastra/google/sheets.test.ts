import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-redis";
import { runTool } from "../../helpers/tool";
import { sheetsTools } from "../../../src/mastra/tools/google/sheets-rest";

vi.mock("../../../src/mastra/tools/google/google-redis", () => import("../../helpers/fake-google-redis"));

const context = { requestContext: { get: () => undefined } } as never;

describe("sheets tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns spreadsheet metadata and sheet tabs", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        spreadsheetId: "sheet123",
        properties: { title: "Budget", locale: "en_US", timeZone: "UTC" },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: "Sheet1",
              index: 0,
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
          { properties: { sheetId: 42, title: "Archive", index: 1, hidden: true } },
        ],
      }),
    );

    const result = await runTool(sheetsTools.sheetsGetSpreadsheetTool, { spreadsheetId: "sheet123" }, context);

    expect(result).toEqual({
      spreadsheetId: "sheet123",
      title: "Budget",
      locale: "en_US",
      timeZone: "UTC",
      url: "https://docs.google.com/spreadsheets/d/sheet123/edit",
      sheets: [
        { sheetId: 0, title: "Sheet1", index: 0, rowCount: 1000, columnCount: 26 },
        { sheetId: 42, title: "Archive", index: 1, hidden: true },
      ],
    });
  });

  it("reads values with A1 ranges", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        range: "Sheet1!A1:B2",
        majorDimension: "ROWS",
        values: [["Name", "Qty"], ["Widget", 3]],
      }),
    );

    const result = await runTool(sheetsTools.sheetsReadValuesTool, 
      {
        spreadsheetId: "sheet123",
        range: "Sheet1!A1:B2",
        majorDimension: "ROWS",
        valueRenderOption: "UNFORMATTED_VALUE",
      },
      context,
    );

    expect(result.values).toEqual([["Name", "Qty"], ["Widget", 3]]);
    expect(calls[0].url.pathname).toBe("/v4/spreadsheets/sheet123/values/Sheet1!A1%3AB2");
    expect(calls[0].url.searchParams.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
  });

  it("writes values with the requested input option", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        spreadsheetId: "sheet123",
        updatedRange: "Sheet1!A1:B1",
        updatedRows: 1,
        updatedColumns: 2,
        updatedCells: 2,
      }),
    );

    const result = await runTool(sheetsTools.sheetsWriteValuesTool, 
      { spreadsheetId: "sheet123", range: "Sheet1!A1", values: [["Name", 3]], valueInputOption: "RAW" },
      context,
    );

    expect(result.updatedCells).toBe(2);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      range: "Sheet1!A1",
      majorDimension: "ROWS",
      values: [["Name", 3]],
    });
  });

  it("unwraps append responses nested under updates", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        spreadsheetId: "sheet123",
        tableRange: "Sheet1!A1:B2",
        updates: { updatedRange: "Sheet1!A3:B3", updatedRows: 1, updatedCells: 2 },
      }),
    );

    const result = await runTool(sheetsTools.sheetsAppendValuesTool, 
      {
        spreadsheetId: "sheet123",
        range: "Sheet1!A1:B1",
        values: [["row", 1]],
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
      },
      context,
    );

    expect(result).toEqual({
      spreadsheetId: "sheet123",
      tableRange: "Sheet1!A1:B2",
      updatedRange: "Sheet1!A3:B3",
      updatedRows: 1,
      updatedCells: 2,
    });
  });

  it("writes multiple ranges in one batch call", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({
        spreadsheetId: "sheet123",
        totalUpdatedCells: 4,
        responses: [
          { updatedRange: "Sheet1!A1", updatedCells: 2 },
          { updatedRange: "Sheet1!C1", updatedCells: 2 },
        ],
      }),
    );

    const result = await runTool(sheetsTools.sheetsBatchUpdateValuesTool, 
      {
        spreadsheetId: "sheet123",
        valueInputOption: "USER_ENTERED",
        data: [
          { range: "Sheet1!A1", values: [["a", "b"]] },
          { range: "Sheet1!C1", values: [["c", "d"]] },
        ],
      },
      context,
    );

    expect(result.totalUpdatedCells).toBe(4);
    expect(result.responses).toHaveLength(2);
    expect(calls[0].url.pathname).toBe("/v4/spreadsheets/sheet123/values:batchUpdate");
  });

  it("adds sheets and clears ranges", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname.endsWith(":batchUpdate")) {
        return jsonResponse({ replies: [{ addSheet: { properties: { sheetId: 7, title: "Summary" } } }] });
      }
      if (url.pathname.endsWith(":clear")) {
        return jsonResponse({ spreadsheetId: "sheet123", clearedRange: "Sheet1!A2:B10" });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const added = await runTool(sheetsTools.sheetsAddSheetTool, 
      { spreadsheetId: "sheet123", title: "Summary" },
      context,
    );
    expect(added).toEqual({ spreadsheetId: "sheet123", sheetId: 7, title: "Summary" });

    const cleared = await runTool(sheetsTools.sheetsClearValuesTool, 
      { spreadsheetId: "sheet123", range: "Sheet1!A2:B10" },
      context,
    );
    expect(cleared.clearedRange).toBe("Sheet1!A2:B10");

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });

  it("passes raw structural batch requests through", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ replies: [{}] }));
    const requests = [
      { updateSheetProperties: { properties: { sheetId: 0, hidden: true }, fields: "hidden" } },
    ];

    const result = await runTool(sheetsTools.sheetsBatchUpdateTool, 
      { spreadsheetId: "sheet123", requests },
      context,
    );

    expect(result.replies).toEqual([{}]);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ requests });
  });
});
