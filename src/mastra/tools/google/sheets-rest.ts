import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleRequest } from "./google-auth";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties?: {
    title?: string;
    locale?: string;
    timeZone?: string;
  };
  sheets?: {
    properties?: {
      sheetId?: number;
      title?: string;
      index?: number;
      hidden?: boolean;
      gridProperties?: { rowCount?: number; columnCount?: number };
    };
  }[];
}

interface ValueRange {
  range?: string;
  majorDimension?: string;
  values?: (string | number | boolean | null)[][];
}

interface UpdateValuesResponse {
  spreadsheetId?: string;
  updatedRange?: string;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
}

interface AppendValuesResponse {
  spreadsheetId?: string;
  tableRange?: string;
  updates?: UpdateValuesResponse;
}

const valueInputOptionSchema = z
  .enum(["RAW", "USER_ENTERED"])
  .default("USER_ENTERED")
  .describe(
    "`USER_ENTERED` parses values the way the Sheets UI does (formulas, dates, numbers); `RAW` stores them as typed",
  );

const valuesSchema = z
  .array(z.array(cellValueSchema))
  .describe("Row-major grid of cell values, e.g. [[\"Name\", \"Qty\"], [\"Widget\", 3]]");

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export const sheetsGetSpreadsheetTool = createTool({
  id: "sheets_get_spreadsheet",
  title: "Sheets: get spreadsheet",
  description:
    "Get spreadsheet metadata: title, locale, time zone, and the list of sheets (tab names, sheet IDs, row/column counts). Use the tab title in A1 ranges.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID from the URL"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    title: z.string().optional(),
    locale: z.string().optional(),
    timeZone: z.string().optional(),
    url: z.string(),
    sheets: z.array(
      z.object({
        sheetId: z.number().optional(),
        title: z.string().optional(),
        index: z.number().optional(),
        hidden: z.boolean().optional(),
        rowCount: z.number().optional(),
        columnCount: z.number().optional(),
      }),
    ),
  }),
  execute: async ({ spreadsheetId }, { requestContext }) => {
    const spreadsheet = await googleRequest<SpreadsheetMetadata>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}`,
      {
        query: { includeGridData: false },
        authContext: { requestContext },
      },
    );

    return {
      spreadsheetId: spreadsheet.spreadsheetId,
      title: spreadsheet.properties?.title,
      locale: spreadsheet.properties?.locale,
      timeZone: spreadsheet.properties?.timeZone,
      url: spreadsheetUrl(spreadsheet.spreadsheetId),
      sheets: (spreadsheet.sheets ?? []).map((sheet) => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index,
        hidden: sheet.properties?.hidden,
        rowCount: sheet.properties?.gridProperties?.rowCount,
        columnCount: sheet.properties?.gridProperties?.columnCount,
      })),
    };
  },
});

export const sheetsReadValuesTool = createTool({
  id: "sheets_read_values",
  title: "Sheets: read values",
  description:
    "Read a cell range using A1 notation, for example `Sheet1!A1:D20` or `Sheet1`. Returns a row-major grid of values.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    range: z.string().describe("A1 notation range, e.g. `Sheet1!A1:D20`"),
    majorDimension: z
      .enum(["ROWS", "COLUMNS"])
      .default("ROWS")
      .describe("Whether the returned grid is grouped by rows or columns"),
    valueRenderOption: z
      .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
      .default("FORMATTED_VALUE")
      .describe("How values are rendered"),
    dateTimeRenderOption: z
      .enum(["SERIAL_NUMBER", "FORMATTED_STRING"])
      .optional()
      .describe("How dates and times are rendered"),
  }),
  outputSchema: z.object({
    range: z.string().optional(),
    majorDimension: z.string().optional(),
    values: z.array(z.array(cellValueSchema)),
  }),
  execute: async (
    { spreadsheetId, range, majorDimension, valueRenderOption, dateTimeRenderOption },
    { requestContext },
  ) => {
    const result = await googleRequest<ValueRange>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      {
        query: { majorDimension, valueRenderOption, dateTimeRenderOption },
        authContext: { requestContext },
      },
    );

    return {
      range: result.range,
      majorDimension: result.majorDimension,
      values: result.values ?? [],
    };
  },
});

export const sheetsWriteValuesTool = createTool({
  id: "sheets_write_values",
  title: "Sheets: write values",
  description:
    "Write values to a range, replacing what is already there. The range's top-left cell anchors the write, and the grid expands to fit.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    range: z.string().describe("A1 notation range, e.g. `Sheet1!A1`"),
    values: valuesSchema,
    valueInputOption: valueInputOptionSchema,
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    updatedRange: z.string().optional(),
    updatedRows: z.number().optional(),
    updatedColumns: z.number().optional(),
    updatedCells: z.number().optional(),
  }),
  execute: async ({ spreadsheetId, range, values, valueInputOption }, { requestContext }) => {
    const result = await googleRequest<UpdateValuesResponse>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
      {
        method: "PUT",
        query: { valueInputOption },
        json: { range, majorDimension: "ROWS", values },
        authContext: { requestContext },
      },
    );

    return {
      spreadsheetId: result.spreadsheetId ?? spreadsheetId,
      updatedRange: result.updatedRange,
      updatedRows: result.updatedRows,
      updatedColumns: result.updatedColumns,
      updatedCells: result.updatedCells,
    };
  },
});

export const sheetsAppendValuesTool = createTool({
  id: "sheets_append_values",
  title: "Sheets: append values",
  description:
    "Append rows after the last row of a table. The range tells Sheets which table to extend, e.g. `Sheet1!A1:D1`.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    range: z.string().describe("A1 notation range identifying the table, e.g. `Sheet1!A1:D1`"),
    values: valuesSchema,
    valueInputOption: valueInputOptionSchema,
    insertDataOption: z
      .enum(["OVERWRITE", "INSERT_ROWS"])
      .default("INSERT_ROWS")
      .describe("Whether to overwrite the data after the table or insert new rows"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    tableRange: z.string().optional(),
    updatedRange: z.string().optional(),
    updatedRows: z.number().optional(),
    updatedCells: z.number().optional(),
  }),
  execute: async (
    { spreadsheetId, range, values, valueInputOption, insertDataOption },
    { requestContext },
  ) => {
    const result = await googleRequest<AppendValuesResponse>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
      {
        method: "POST",
        query: { valueInputOption, insertDataOption },
        json: { range, majorDimension: "ROWS", values },
        authContext: { requestContext },
      },
    );

    return {
      spreadsheetId: result.spreadsheetId ?? spreadsheetId,
      tableRange: result.tableRange,
      updatedRange: result.updates?.updatedRange,
      updatedRows: result.updates?.updatedRows,
      updatedCells: result.updates?.updatedCells,
    };
  },
});

export const sheetsBatchUpdateValuesTool = createTool({
  id: "sheets_batch_update_values",
  title: "Sheets: batch update values",
  description:
    "Write several disjoint ranges in one request. More efficient than calling `sheets_write_values` repeatedly.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    valueInputOption: valueInputOptionSchema,
    data: z
      .array(
        z.object({
          range: z.string().describe("A1 notation range"),
          values: valuesSchema,
        }),
      )
      .min(1)
      .describe("Ranges to write"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    totalUpdatedCells: z.number().optional(),
    responses: z.array(
      z.object({
        updatedRange: z.string().optional(),
        updatedRows: z.number().optional(),
        updatedCells: z.number().optional(),
      }),
    ),
  }),
  execute: async ({ spreadsheetId, valueInputOption, data }, { requestContext }) => {
    const result = await googleRequest<{
      spreadsheetId?: string;
      totalUpdatedCells?: number;
      responses?: UpdateValuesResponse[];
    }>(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: "POST",
      json: {
        valueInputOption,
        data: data.map((entry) => ({ ...entry, majorDimension: "ROWS" })),
      },
      authContext: { requestContext },
    });

    return {
      spreadsheetId: result.spreadsheetId ?? spreadsheetId,
      totalUpdatedCells: result.totalUpdatedCells,
      responses: (result.responses ?? []).map((response) => ({
        updatedRange: response.updatedRange,
        updatedRows: response.updatedRows,
        updatedCells: response.updatedCells,
      })),
    };
  },
});

export const sheetsClearValuesTool = createTool({
  id: "sheets_clear_values",
  title: "Sheets: clear values",
  description: "Clear the values in a range while keeping formatting and the sheet itself.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    range: z.string().describe("A1 notation range to clear, e.g. `Sheet1!A2:Z1000`"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    clearedRange: z.string().optional(),
  }),
  execute: async ({ spreadsheetId, range }, { requestContext }) => {
    const result = await googleRequest<{ spreadsheetId?: string; clearedRange?: string }>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
      { method: "POST", json: {}, authContext: { requestContext } },
    );

    return {
      spreadsheetId: result.spreadsheetId ?? spreadsheetId,
      clearedRange: result.clearedRange,
    };
  },
});

export const sheetsAddSheetTool = createTool({
  id: "sheets_add_sheet",
  title: "Sheets: add sheet",
  description: "Add a new tab to a spreadsheet.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    title: z.string().describe("Title for the new tab"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().optional(),
    title: z.string().optional(),
  }),
  execute: async ({ spreadsheetId, title }, { requestContext }) => {
    const result = await googleRequest<{
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    }>(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      json: { requests: [{ addSheet: { properties: { title } } }] },
      authContext: { requestContext },
    });

    const properties = result.replies?.[0]?.addSheet?.properties;

    return {
      spreadsheetId,
      sheetId: properties?.sheetId,
      title: properties?.title,
    };
  },
});

export const sheetsBatchUpdateTool = createTool({
  id: "sheets_batch_update",
  title: "Sheets: batch update structure",
  description:
    "Escape hatch for the Sheets batchUpdate API: formatting, merges, resizing, sorting, deleting sheets, and other structural changes. Accepts raw sheet `Request` objects.",
  inputSchema: z.object({
    spreadsheetId: z.string().describe("Spreadsheet ID"),
    requests: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("Raw Sheets API requests, e.g. [{ updateSheetProperties: { properties: { sheetId: 0 }, fields: 'title' } }]"),
  }),
  outputSchema: z.object({
    spreadsheetId: z.string(),
    replies: z.array(z.unknown()),
  }),
  execute: async ({ spreadsheetId, requests }, { requestContext }) => {
    const result = await googleRequest<{ replies?: unknown[] }>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        json: { requests },
        authContext: { requestContext },
      },
    );

    return {
      spreadsheetId,
      replies: result.replies ?? [],
    };
  },
});

export const sheetsTools = {
  sheetsGetSpreadsheetTool,
  sheetsReadValuesTool,
  sheetsWriteValuesTool,
  sheetsAppendValuesTool,
  sheetsBatchUpdateValuesTool,
  sheetsClearValuesTool,
  sheetsAddSheetTool,
  sheetsBatchUpdateTool,
};
