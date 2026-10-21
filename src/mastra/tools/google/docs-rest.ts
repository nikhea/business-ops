import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleRequest } from "./google-auth";

const DOCS_BASE = "https://docs.googleapis.com/v1/documents";

interface DocsTextRun {
  content?: string;
}

interface DocsStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: { elements?: { textRun?: DocsTextRun }[] };
  table?: {
    tableRows?: {
      tableCells?: { content?: DocsStructuralElement[] }[];
    }[];
  };
  tableOfContents?: { content?: DocsStructuralElement[] };
}

interface DocsDocument {
  documentId: string;
  title?: string;
  revisionId?: string;
  body?: { content?: DocsStructuralElement[] };
}

function documentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

function renderElement(element: DocsStructuralElement): string {
  if (element.paragraph) {
    return (element.paragraph.elements ?? [])
      .map((run) => run.textRun?.content ?? "")
      .join("");
  }

  if (element.table) {
    return (element.table.tableRows ?? [])
      .map((row) =>
        (row.tableCells ?? []).map((cell) => extractText(cell.content)).join("\t"),
      )
      .join("\n");
  }

  if (element.tableOfContents) {
    return extractText(element.tableOfContents.content);
  }

  return "";
}

function extractText(content: DocsStructuralElement[] | undefined): string {
  if (!content) return "";
  return content.map(renderElement).join("");
}

function documentEndIndex(document: DocsDocument): number {
  const content = document.body?.content ?? [];
  const lastElement = content[content.length - 1];
  return Math.max(1, (lastElement?.endIndex ?? 2) - 1);
}

async function getDocument(
  documentId: string,
  requestContext: { get?: (key: string) => unknown } | undefined,
): Promise<DocsDocument> {
  return googleRequest<DocsDocument>(`${DOCS_BASE}/${encodeURIComponent(documentId)}`, {
    authContext: { requestContext },
  });
}

async function batchUpdate(
  documentId: string,
  requests: Record<string, unknown>[],
  requestContext: { get?: (key: string) => unknown } | undefined,
): Promise<{ replies?: unknown[] }> {
  return googleRequest<{ replies?: unknown[] }>(
    `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: "POST",
      json: { requests },
      authContext: { requestContext },
    },
  );
}

export const docsGetDocumentTool = createTool({
  id: "docs_get_document",
  title: "Docs: get document",
  description:
    "Read a Google Doc: title, revision, and extracted plain text (paragraphs and tables). Set `includeBody` for the full structural body.",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc ID from the URL"),
    includeBody: z
      .boolean()
      .default(false)
      .describe("Include the raw Docs API body structure (can be large)"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    title: z.string().optional(),
    revisionId: z.string().optional(),
    url: z.string(),
    text: z.string(),
    body: z.unknown().optional(),
  }),
  execute: async ({ documentId, includeBody }, { requestContext }) => {
    const document = await getDocument(documentId, requestContext);

    return {
      documentId: document.documentId,
      title: document.title,
      revisionId: document.revisionId,
      url: documentUrl(document.documentId),
      text: extractText(document.body?.content),
      body: includeBody ? document.body : undefined,
    };
  },
});

export const docsCreateDocumentTool = createTool({
  id: "docs_create_document",
  title: "Docs: create document",
  description:
    "Create a new Google Doc, optionally with initial plain text. Saved in the user's Drive root.",
  inputSchema: z.object({
    title: z.string().describe("Document title"),
    initialText: z.string().optional().describe("Plain text to insert at the start of the document"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    title: z.string().optional(),
    url: z.string(),
  }),
  execute: async ({ title, initialText }, { requestContext }) => {
    const document = await googleRequest<DocsDocument>(DOCS_BASE, {
      method: "POST",
      json: { title },
      authContext: { requestContext },
    });

    if (initialText) {
      await batchUpdate(
        document.documentId,
        [{ insertText: { location: { index: 1 }, text: initialText } }],
        requestContext,
      );
    }

    return {
      documentId: document.documentId,
      title: document.title,
      url: documentUrl(document.documentId),
    };
  },
});

export const docsAppendTextTool = createTool({
  id: "docs_append_text",
  title: "Docs: append text",
  description:
    "Append plain text to the end of a Google Doc. Finds the end of the document automatically.",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc ID"),
    text: z.string().describe("Text to append"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    insertedAt: z.number(),
    characters: z.number(),
  }),
  execute: async ({ documentId, text }, { requestContext }) => {
    const document = await getDocument(documentId, requestContext);
    const index = documentEndIndex(document);

    await batchUpdate(documentId, [{ insertText: { location: { index }, text } }], requestContext);

    return {
      documentId,
      insertedAt: index,
      characters: text.length,
    };
  },
});

export const docsInsertTextTool = createTool({
  id: "docs_insert_text",
  title: "Docs: insert text",
  description:
    "Insert plain text at a specific character index. Index 1 is the start of the document; omit `index` to append at the end.",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc ID"),
    text: z.string().describe("Text to insert"),
    index: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("1-based character index to insert at; omit to append at the end"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    insertedAt: z.number(),
    characters: z.number(),
  }),
  execute: async ({ documentId, text, index }, { requestContext }) => {
    let insertIndex = index;

    if (insertIndex === undefined) {
      const document = await getDocument(documentId, requestContext);
      insertIndex = documentEndIndex(document);
    }

    await batchUpdate(
      documentId,
      [{ insertText: { location: { index: insertIndex }, text } }],
      requestContext,
    );

    return {
      documentId,
      insertedAt: insertIndex,
      characters: text.length,
    };
  },
});

export const docsReplaceAllTextTool = createTool({
  id: "docs_replace_all_text",
  title: "Docs: replace all text",
  description:
    "Find and replace every occurrence of a string in a Google Doc. Useful for templates and mail merges.",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc ID"),
    find: z.string().describe("Text to search for"),
    replace: z.string().describe("Replacement text"),
    matchCase: z.boolean().default(false).describe("Require an exact case match"),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    occurrencesChanged: z.number(),
  }),
  execute: async ({ documentId, find, replace, matchCase }, { requestContext }) => {
    const result = await batchUpdate(
      documentId,
      [
        {
          replaceAllText: {
            containsText: { text: find, matchCase },
            replaceText: replace,
          },
        },
      ],
      requestContext,
    );

    const reply = result.replies?.[0] as { replaceAllText?: { occurrencesChanged?: number } } | undefined;

    return {
      documentId,
      occurrencesChanged: reply?.replaceAllText?.occurrencesChanged ?? 0,
    };
  },
});

export const docsBatchUpdateTool = createTool({
  id: "docs_batch_update",
  title: "Docs: batch update",
  description:
    "Escape hatch for the Docs batchUpdate API: styling, bullets, table insertion, image insertion, deletion ranges, and other structural edits. Accepts raw Docs `Request` objects.",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc ID"),
    requests: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe(
        "Raw Docs API requests, e.g. [{ deleteContentRange: { range: { startIndex: 1, endIndex: 10 } } }]",
      ),
  }),
  outputSchema: z.object({
    documentId: z.string(),
    replies: z.array(z.unknown()),
  }),
  execute: async ({ documentId, requests }, { requestContext }) => {
    const result = await batchUpdate(documentId, requests, requestContext);

    return {
      documentId,
      replies: result.replies ?? [],
    };
  },
});

export const docsTools = {
  docsGetDocumentTool,
  docsCreateDocumentTool,
  docsAppendTextTool,
  docsInsertTextTool,
  docsReplaceAllTextTool,
  docsBatchUpdateTool,
};
