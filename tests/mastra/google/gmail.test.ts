import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { resetFakeGoogleStore } from "../../helpers/fake-google-store";
import { runTool } from "../../helpers/tool";
import { gmailTools } from "../../../src/mastra/tools/google/gmail-rest";

vi.mock("../../../src/mastra/tools/google/google-store", () => import("../../helpers/fake-google-store"));

const context = { requestContext: { get: () => undefined } } as never;

const messageMetadata = {
  id: "m1",
  threadId: "t1",
  snippet: "hello there",
  labelIds: ["INBOX", "UNREAD"],
  payload: {
    headers: [
      { name: "Subject", value: "Hello" },
      { name: "From", value: "Alice <alice@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Date", value: "Wed, 21 Oct 2026 10:00:00 +0000" },
    ],
  },
};

describe("gmail tools", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "test-access-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists messages with metadata headers", async () => {
    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/gmail/v1/users/me/messages") {
        return jsonResponse({ messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 });
      }
      if (method === "GET" && url.pathname === "/gmail/v1/users/me/messages/m1") {
        return jsonResponse(messageMetadata);
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const result = await runTool(gmailTools.gmailListMessagesTool, 
      { query: "is:unread", maxResults: 5, includeSpamTrash: false },
      context,
    );

    expect(result.messages).toEqual([
      {
        id: "m1",
        threadId: "t1",
        subject: "Hello",
        from: "Alice <alice@example.com>",
        to: "me@example.com",
        date: "Wed, 21 Oct 2026 10:00:00 +0000",
        snippet: "hello there",
        labelIds: ["INBOX", "UNREAD"],
      },
    ]);
    expect(result.resultSizeEstimate).toBe(1);

    const listCall = calls[0];
    expect(listCall.url.searchParams.get("q")).toBe("is:unread");
    expect(listCall.url.searchParams.get("maxResults")).toBe("5");
    expect(listCall.url.searchParams.get("includeSpamTrash")).toBe("false");
    expect(listCall.headers.get("authorization")).toBe("Bearer test-access-token");

    const metadataCall = calls.find((call) => call.url.pathname === "/gmail/v1/users/me/messages/m1");
    expect(metadataCall?.url.searchParams.get("format")).toBe("metadata");
    expect(metadataCall?.url.searchParams.getAll("metadataHeaders")).toEqual([
      "Subject",
      "From",
      "To",
      "Date",
    ]);
  });

  it("decodes message bodies and lists attachments", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        id: "m1",
        threadId: "t1",
        snippet: "hello",
        labelIds: ["INBOX"],
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "alice@example.com" },
            { name: "Cc", value: "carol@example.com" },
          ],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { data: Buffer.from("plain body").toString("base64url") } },
                { mimeType: "text/html", body: { data: Buffer.from("<p>html body</p>").toString("base64url") } },
              ],
            },
            {
              mimeType: "application/pdf",
              filename: "report.pdf",
              body: { size: 2048, attachmentId: "att1" },
            },
          ],
        },
      }),
    );

    const result = await runTool(gmailTools.gmailGetMessageTool, { messageId: "m1", format: "full" }, context);

    expect(result.bodyText).toBe("plain body");
    expect(result.bodyHtml).toBe("<p>html body</p>");
    expect(result.cc).toBe("carol@example.com");
    expect(result.attachments).toEqual([
      { filename: "report.pdf", mimeType: "application/pdf", size: 2048, attachmentId: "att1" },
    ]);
  });

  it("builds a MIME message and strips header injection from the subject", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ id: "sent1", threadId: "t9" }));

    await runTool(gmailTools.gmailSendMessageTool, 
      {
        to: "alice@example.com",
        cc: "bob@example.com",
        subject: "Report\r\nBcc: evil@example.com",
        body: "Hello world",
        html: "<p>Hello world</p>",
      },
      context,
    );

    expect(calls[0].url.pathname).toBe("/gmail/v1/users/me/messages/send");
    expect(calls[0].method).toBe("POST");

    const payload = JSON.parse(calls[0].body ?? "{}") as { raw: string };
    const raw = Buffer.from(payload.raw, "base64url").toString("utf8");

    expect(raw).toContain("To: alice@example.com");
    expect(raw).toContain("Cc: bob@example.com");
    expect(raw).toContain("Subject: Report Bcc: evil@example.com");
    expect(raw).toMatch(/^MIME-Version: 1.0$/m);
    expect(raw).toMatch(/^Content-Type: multipart\/alternative; boundary="mastra_/m);
    expect(raw).not.toMatch(/^Bcc: evil@example\.com$/m);
  });

  it("replies in the original thread with proper threading headers", async () => {
    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/gmail/v1/users/me/messages/orig1") {
        return jsonResponse({
          id: "orig1",
          threadId: "thread-1",
          payload: {
            headers: [
              { name: "Message-ID", value: "<orig@example.com>" },
              { name: "References", value: "<root@example.com>" },
              { name: "Subject", value: "Original subject" },
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "To", value: "me@example.com" },
              { name: "Cc", value: "carol@example.com" },
            ],
          },
        });
      }
      if (method === "POST" && url.pathname === "/gmail/v1/users/me/messages/send") {
        return jsonResponse({ id: "reply1", threadId: "thread-1" });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    await runTool(gmailTools.gmailReplyTool, 
      { messageId: "orig1", body: "Thanks", replyAll: true },
      context,
    );

    const sendCall = calls.find((call) => call.url.pathname === "/gmail/v1/users/me/messages/send");
    const payload = JSON.parse(sendCall?.body ?? "{}") as { raw: string; threadId: string };
    const raw = Buffer.from(payload.raw, "base64url").toString("utf8");

    expect(payload.threadId).toBe("thread-1");
    expect(raw).toContain("In-Reply-To: <orig@example.com>");
    expect(raw).toContain("References: <root@example.com> <orig@example.com>");
    expect(raw).toContain("Subject: Re: Original subject");
    expect(raw).toContain("To: Alice <alice@example.com>");
    expect(raw).toContain("Cc: me@example.com, carol@example.com");
  });

  it("lists labels, modifies them, and trashes messages", async () => {
    const { calls } = mockGoogleFetch(({ url, method }) => {
      if (method === "GET" && url.pathname === "/gmail/v1/users/me/labels") {
        return jsonResponse({
          labels: [
            { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 10, messagesUnread: 2 },
            { id: "Label_1", name: "Work", type: "user" },
          ],
        });
      }
      if (method === "POST" && url.pathname === "/gmail/v1/users/me/messages/m1/modify") {
        return jsonResponse({ id: "m1", labelIds: ["STARRED"] });
      }
      if (method === "POST" && url.pathname === "/gmail/v1/users/me/messages/m1/trash") {
        return jsonResponse({ id: "m1", threadId: "t1", labelIds: ["TRASH"] });
      }
      return jsonResponse({ error: { message: "unexpected" } }, 404);
    });

    const labels = await runTool(gmailTools.gmailListLabelsTool, {}, context);
    expect(labels.labels).toHaveLength(2);

    const modified = await runTool(gmailTools.gmailModifyLabelsTool, 
      { messageId: "m1", addLabelIds: ["STARRED"], removeLabelIds: ["UNREAD"] },
      context,
    );
    expect(modified.labelIds).toEqual(["STARRED"]);

    const modifyCall = calls.find((call) => call.url.pathname.endsWith("/modify"));
    expect(JSON.parse(modifyCall?.body ?? "{}")).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });

    const trashed = await runTool(gmailTools.gmailTrashMessageTool, { messageId: "m1", action: "trash" }, context);
    expect(trashed.labelIds).toEqual(["TRASH"]);
    expect(calls.some((call) => call.url.pathname.endsWith("/messages/m1/trash"))).toBe(true);
  });

  it("returns the authenticated account profile", async () => {
    mockGoogleFetch(() =>
      jsonResponse({
        emailAddress: "user@example.com",
        messagesTotal: 42,
        threadsTotal: 20,
        historyId: "12345",
      }),
    );

    const profile = await runTool(gmailTools.gmailGetProfileTool, {}, context);

    expect(profile).toEqual({
      emailAddress: "user@example.com",
      messagesTotal: 42,
      threadsTotal: 20,
      historyId: "12345",
    });
  });
});
