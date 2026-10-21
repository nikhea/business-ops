import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  googleRequest,
  mapWithConcurrency,
  sanitizeHeaderValue,
  type GoogleToolContext,
} from "./google-auth";
import { gmailGetProfileTool } from "./gmail-profile-tool";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const target = name.toLowerCase();
  return headers?.find((header) => header.name?.toLowerCase() === target)?.value;
}

function decodeBase64Url(data?: string): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function collectBody(part?: GmailPart): { text: string; html: string } {
  const text: string[] = [];
  const html: string[] = [];

  const walk = (node?: GmailPart) => {
    if (!node) return;
    if (node.mimeType === "text/plain" && node.body?.data) {
      text.push(decodeBase64Url(node.body.data));
    } else if (node.mimeType === "text/html" && node.body?.data) {
      html.push(decodeBase64Url(node.body.data));
    }
    node.parts?.forEach(walk);
  };

  walk(part);
  return { text: text.join("\n").trim(), html: html.join("\n").trim() };
}

function collectAttachments(part?: GmailPart): { filename: string; mimeType: string; size: number; attachmentId: string }[] {
  const attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];

  const walk = (node?: GmailPart) => {
    if (!node) return;
    if (node.filename && node.body?.attachmentId) {
      attachments.push({
        filename: node.filename,
        mimeType: node.mimeType ?? "application/octet-stream",
        size: node.body.size ?? 0,
        attachmentId: node.body.attachmentId,
      });
    }
    node.parts?.forEach(walk);
  };

  walk(part);
  return attachments;
}

function summarizeMessage(message: GmailMessage) {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId,
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    date: getHeader(headers, "Date"),
    snippet: message.snippet,
    labelIds: message.labelIds,
  };
}

function encodeHeaderWord(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(sanitized)) return sanitized;
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function base64Block(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
}

function buildMimeBody(text: string | undefined, html: string | undefined): string {
  if (text && html) {
    const boundary = `mastra_${randomUUID()}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Block(text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Block(html),
      `--${boundary}--`,
    ].join("\r\n");
  }

  if (html) {
    return [
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Block(html),
    ].join("\r\n");
  }

  return [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Block(text ?? ""),
  ].join("\r\n");
}

interface RawMessageInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}

function buildRawMessage(input: RawMessageInput): string {
  const headers = [`To: ${sanitizeHeaderValue(input.to)}`];

  if (input.cc) headers.push(`Cc: ${sanitizeHeaderValue(input.cc)}`);
  if (input.bcc) headers.push(`Bcc: ${sanitizeHeaderValue(input.bcc)}`);

  headers.push(
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  );

  if (input.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${sanitizeHeaderValue(input.references)}`);

  const message = `${headers.join("\r\n")}\r\n${buildMimeBody(input.text, input.html)}`;
  return Buffer.from(message, "utf8").toString("base64url");
}

interface SendMessageResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
}

async function sendRaw(
  raw: string,
  threadId: string | undefined,
  context: GoogleToolContext,
): Promise<SendMessageResponse> {
  return googleRequest<SendMessageResponse>(`${GMAIL_BASE}/users/me/messages/send`, {
    method: "POST",
    json: threadId ? { raw, threadId } : { raw },
    authContext: context,
  });
}

const gmailMessageSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  subject: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  snippet: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
});

const sendOutputSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});

export const gmailListMessagesTool = createTool({
  id: "gmail_list_messages",
  title: "Gmail: list messages",
  description:
    "Search the mailbox and return matching messages with subject, sender, recipients, date and snippet. Supports Gmail search syntax, for example `from:alice@example.com is:unread newer_than:7d`.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Gmail search query, e.g. `is:unread from:boss@example.com`"),
    labelIds: z.array(z.string()).optional().describe("Only return messages with these label IDs"),
    maxResults: z.number().int().min(1).max(50).default(10).describe("Maximum messages to return"),
    includeSpamTrash: z.boolean().default(false).describe("Include messages from SPAM and TRASH"),
    pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  }),
  outputSchema: z.object({
    messages: z.array(gmailMessageSummarySchema),
    nextPageToken: z.string().optional(),
    resultSizeEstimate: z.number().optional(),
  }),
  execute: async ({ query, labelIds, maxResults, includeSpamTrash, pageToken }, { requestContext }) => {
    const context: GoogleToolContext = { requestContext };

    const list = await googleRequest<GmailListResponse>(`${GMAIL_BASE}/users/me/messages`, {
      query: { q: query, labelIds, maxResults, includeSpamTrash, pageToken },
      authContext: context,
    });

    const messages = await mapWithConcurrency(list.messages ?? [], 5, async (message) => {
      const full = await googleRequest<GmailMessage>(
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message.id)}`,
        {
          query: {
            format: "metadata",
            metadataHeaders: ["Subject", "From", "To", "Date"],
          },
          authContext: context,
        },
      );
      return summarizeMessage(full);
    });

    return {
      messages,
      nextPageToken: list.nextPageToken,
      resultSizeEstimate: list.resultSizeEstimate,
    };
  },
});

export const gmailGetMessageTool = createTool({
  id: "gmail_get_message",
  title: "Gmail: get message",
  description:
    "Fetch a single Gmail message by ID, including headers, decoded plain-text and HTML bodies, and attachment metadata.",
  inputSchema: z.object({
    messageId: z.string().describe("Gmail message ID"),
    format: z
      .enum(["full", "metadata", "raw"])
      .default("full")
      .describe("`full` decodes bodies, `metadata` returns headers only, `raw` returns the raw RFC 2822 message as base64url"),
  }),
  outputSchema: z.object({
    id: z.string(),
    threadId: z.string(),
    subject: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    cc: z.string().optional(),
    date: z.string().optional(),
    snippet: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
    bodyText: z.string().optional(),
    bodyHtml: z.string().optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
          attachmentId: z.string(),
        }),
      )
      .optional(),
    raw: z.string().optional(),
  }),
  execute: async ({ messageId, format }, { requestContext }) => {
    const message = await googleRequest<GmailMessage & { raw?: string }>(
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}`,
      { query: { format }, authContext: { requestContext } },
    );

    const summary = summarizeMessage(message);
    const headers = message.payload?.headers;
    const body = format === "full" ? collectBody(message.payload) : { text: "", html: "" };
    const attachments = format === "full" ? collectAttachments(message.payload) : [];

    return {
      ...summary,
      cc: getHeader(headers, "Cc"),
      bodyText: body.text || undefined,
      bodyHtml: body.html || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: message.raw,
    };
  },
});

const composeInputSchema = z.object({
  to: z.string().describe("Recipient address(es), comma separated"),
  cc: z.string().optional().describe("CC address(es), comma separated"),
  bcc: z.string().optional().describe("BCC address(es), comma separated"),
  subject: z.string().describe("Subject line"),
  body: z.string().describe("Plain-text body"),
  html: z.string().optional().describe("Optional HTML body; sent as a multipart alternative with `body`"),
});

export const gmailSendMessageTool = createTool({
  id: "gmail_send_message",
  title: "Gmail: send message",
  description: "Send a new email from the authenticated Gmail account.",
  inputSchema: composeInputSchema,
  outputSchema: sendOutputSchema,
  execute: async ({ to, cc, bcc, subject, body, html }, { requestContext }) => {
    const raw = buildRawMessage({ to, cc, bcc, subject, text: body, html });
    return sendRaw(raw, undefined, { requestContext });
  },
});

export const gmailCreateDraftTool = createTool({
  id: "gmail_create_draft",
  title: "Gmail: create draft",
  description: "Create an unsent draft email in the authenticated Gmail account.",
  inputSchema: composeInputSchema,
  outputSchema: z.object({
    draftId: z.string(),
    messageId: z.string(),
    threadId: z.string(),
  }),
  execute: async ({ to, cc, bcc, subject, body, html }, { requestContext }) => {
    const raw = buildRawMessage({ to, cc, bcc, subject, text: body, html });

    const draft = await googleRequest<{ id: string; message: SendMessageResponse }>(
      `${GMAIL_BASE}/users/me/drafts`,
      { method: "POST", json: { message: { raw } }, authContext: { requestContext } },
    );

    return {
      draftId: draft.id,
      messageId: draft.message.id,
      threadId: draft.message.threadId,
    };
  },
});

export const gmailReplyTool = createTool({
  id: "gmail_reply",
  title: "Gmail: reply",
  description:
    "Reply to an existing message in its thread. Sets In-Reply-To, References, thread ID and a `Re:` subject based on the original message.",
  inputSchema: z.object({
    messageId: z.string().describe("ID of the message being replied to"),
    body: z.string().describe("Plain-text reply body"),
    html: z.string().optional().describe("Optional HTML reply body"),
    replyAll: z.boolean().default(false).describe("Include the original To and Cc recipients"),
  }),
  outputSchema: sendOutputSchema,
  execute: async ({ messageId, body, html, replyAll }, { requestContext }) => {
    const context: GoogleToolContext = { requestContext };

    const original = await googleRequest<GmailMessage>(
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}`,
      {
        query: {
          format: "metadata",
          metadataHeaders: ["Message-ID", "References", "Subject", "From", "To", "Cc"],
        },
        authContext: context,
      },
    );

    const headers = original.payload?.headers;
    const originalFrom = getHeader(headers, "From") ?? "";
    const originalSubject = getHeader(headers, "Subject") ?? "";
    const originalMessageId = getHeader(headers, "Message-ID") ?? "";
    const originalReferences = getHeader(headers, "References") ?? "";

    const subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
    const references = [originalReferences, originalMessageId].filter(Boolean).join(" ");
    const cc = replyAll
      ? [getHeader(headers, "To"), getHeader(headers, "Cc")].filter(Boolean).join(", ")
      : undefined;

    const raw = buildRawMessage({
      to: originalFrom,
      cc: cc || undefined,
      subject,
      text: body,
      html,
      inReplyTo: originalMessageId || undefined,
      references: references || undefined,
    });

    return sendRaw(raw, original.threadId, context);
  },
});

export const gmailModifyLabelsTool = createTool({
  id: "gmail_modify_labels",
  title: "Gmail: modify labels",
  description:
    "Add or remove labels on a message. Common system labels: INBOX, UNREAD, STARRED, IMPORTANT, SPAM, TRASH. Use empty `addLabelIds` to archive by removing INBOX.",
  inputSchema: z.object({
    messageId: z.string().describe("Gmail message ID"),
    addLabelIds: z.array(z.string()).default([]).describe("Label IDs to add"),
    removeLabelIds: z.array(z.string()).default([]).describe("Label IDs to remove"),
  }),
  outputSchema: z.object({
    id: z.string(),
    labelIds: z.array(z.string()).optional(),
  }),
  execute: async ({ messageId, addLabelIds, removeLabelIds }, { requestContext }) =>
    googleRequest<{ id: string; labelIds?: string[] }>(
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: "POST",
        json: { addLabelIds, removeLabelIds },
        authContext: { requestContext },
      },
    ),
});

export const gmailTrashMessageTool = createTool({
  id: "gmail_trash_message",
  title: "Gmail: trash or untrash message",
  description: "Move a message to the trash, or restore it from the trash.",
  inputSchema: z.object({
    messageId: z.string().describe("Gmail message ID"),
    action: z.enum(["trash", "untrash"]).default("trash").describe("Whether to trash or restore the message"),
  }),
  outputSchema: z.object({
    id: z.string(),
    threadId: z.string(),
    labelIds: z.array(z.string()).optional(),
  }),
  execute: async ({ messageId, action }, { requestContext }) =>
    googleRequest<SendMessageResponse>(
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/${action}`,
      { method: "POST", authContext: { requestContext } },
    ),
});

export const gmailListLabelsTool = createTool({
  id: "gmail_list_labels",
  title: "Gmail: list labels",
  description: "List all Gmail labels (system and user-created) with their IDs and message counts.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    labels: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().optional(),
        messagesTotal: z.number().optional(),
        messagesUnread: z.number().optional(),
      }),
    ),
  }),
  execute: async (_input, { requestContext }) => {
    const response = await googleRequest<{
      labels?: {
        id: string;
        name: string;
        type?: string;
        messagesTotal?: number;
        messagesUnread?: number;
      }[];
    }>(`${GMAIL_BASE}/users/me/labels`, { authContext: { requestContext } });

    return { labels: response.labels ?? [] };
  },
});

export const gmailTools = {
  gmailGetProfileTool,
  gmailListMessagesTool,
  gmailGetMessageTool,
  gmailSendMessageTool,
  gmailCreateDraftTool,
  gmailReplyTool,
  gmailModifyLabelsTool,
  gmailTrashMessageTool,
  gmailListLabelsTool,
};
