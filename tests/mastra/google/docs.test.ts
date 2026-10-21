import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-redis";
import { runTool } from "../../helpers/tool";
import { docsTools } from "../../../src/mastra/tools/google/docs-rest";

vi.mock("../../../src/mastra/tools/google/google-redis", () => import("../../helpers/fake-google-redis"));

const context = { requestContext: { get: () => undefined } } as never;

const documentBody = {
  content: [
    {
      startIndex: 1,
      endIndex: 12,
      paragraph: {
        elements: [{ textRun: { content: "Hello " } }, { textRun: { content: "world\n" } }],
      },
    },
    {
      startIndex: 12,
      endIndex: 20,
      table: {
        tableRows: [
          { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "A\n" } }] } }] }] },
          { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: "B\n" } }] } }] }] },
        ],
      },
    },
    { startIndex: 20, endIndex: 21, sectionBreak: {} },
  ],
};

describe("docs tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts text from paragraphs and tables", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        documentId: "doc123",
        title: "Contract",
        revisionId: "rev1",
        body: documentBody,
      }),
    );

    const result = await runTool(docsTools.docsGetDocumentTool, 
      { documentId: "doc123", includeBody: false },
      context,
    );

    expect(result.documentId).toBe("doc123");
    expect(result.title).toBe("Contract");
    expect(result.text).toBe("Hello world\nA\n\nB\n");
    expect(result.url).toBe("https://docs.google.com/document/d/doc123/edit");
    expect(result.body).toBeUndefined();
  });

  it("creates documents and inserts initial text", async () => {
    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "POST" && url.pathname === "/v1/documents") {
        return jsonResponse({ documentId: "doc123", title: "Contract" });
      }
      if (method === "POST" && url.pathname === "/v1/documents/doc123:batchUpdate") {
        return jsonResponse({ replies: [{}] });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const result = await runTool(docsTools.docsCreateDocumentTool, 
      { title: "Contract", initialText: "Start here\n" },
      context,
    );

    expect(result).toEqual({
      documentId: "doc123",
      title: "Contract",
      url: "https://docs.google.com/document/d/doc123/edit",
    });

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ title: "Contract" });
    expect(JSON.parse(calls[1].body ?? "{}")).toEqual({
      requests: [{ insertText: { location: { index: 1 }, text: "Start here\n" } }],
    });
  });

  it("appends text at the end of the document body", async () => {
    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/v1/documents/doc123") {
        return jsonResponse({ documentId: "doc123", body: documentBody });
      }
      if (method === "POST" && url.pathname === "/v1/documents/doc123:batchUpdate") {
        return jsonResponse({ replies: [{}] });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const result = await runTool(docsTools.docsAppendTextTool, 
      { documentId: "doc123", text: "More\n" },
      context,
    );

    expect(result).toEqual({ documentId: "doc123", insertedAt: 20, characters: 5 });

    const update = JSON.parse(calls[1].body ?? "{}");
    expect(update.requests[0].insertText).toEqual({ location: { index: 20 }, text: "More\n" });
  });

  it("inserts text at an explicit index", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ replies: [{}] }));

    const result = await runTool(docsTools.docsInsertTextTool, 
      { documentId: "doc123", text: "Start: ", index: 1 },
      context,
    );

    expect(result.insertedAt).toBe(1);
    expect(JSON.parse(calls[0].body ?? "{}").requests[0].insertText.location.index).toBe(1);
  });

  it("replaces all matching text and reports occurrences", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ replies: [{ replaceAllText: { occurrencesChanged: 3 } }] }),
    );

    const result = await runTool(docsTools.docsReplaceAllTextTool, 
      { documentId: "doc123", find: "{{name}}", replace: "Ada", matchCase: false },
      context,
    );

    expect(result).toEqual({ documentId: "doc123", occurrencesChanged: 3 });
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      requests: [
        {
          replaceAllText: {
            containsText: { text: "{{name}}", matchCase: false },
            replaceText: "Ada",
          },
        },
      ],
    });
  });

  it("passes raw batch requests through", async () => {
    mockGoogleFetch(() => jsonResponse({ replies: [{}] }));
    const requests = [{ deleteContentRange: { range: { startIndex: 1, endIndex: 2 } } }];

    const result = await runTool(docsTools.docsBatchUpdateTool, 
      { documentId: "doc123", requests },
      context,
    );

    expect(result).toEqual({ documentId: "doc123", replies: [{}] });
  });
});
