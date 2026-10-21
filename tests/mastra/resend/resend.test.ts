import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { runTool } from "../../helpers/tool";
import {
  ResendApiError,
  ResendAuthError,
  resolveResendApiKey,
} from "../../../src/mastra/tools/resend/resend-auth";
import { resendEmailTools } from "../../../src/mastra/tools/resend/resend-emails";
import { resendDomainTools } from "../../../src/mastra/tools/resend/resend-domains";
import { resendContactTools } from "../../../src/mastra/tools/resend/resend-contacts";
import { resendSegmentTools } from "../../../src/mastra/tools/resend/resend-segments";
import { resendBroadcastTools } from "../../../src/mastra/tools/resend/resend-broadcasts";
import { resendTemplateTools } from "../../../src/mastra/tools/resend/resend-templates";
import { resendWebhookTools } from "../../../src/mastra/tools/resend/resend-webhooks";
import { resendTopicTools } from "../../../src/mastra/tools/resend/resend-topics";

function body(call: { body?: string }) {
  return call.body ? JSON.parse(call.body) : undefined;
}

describe("resend tools", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_TOKEN;
  });

  it("throws a clear error when no API key is configured", () => {
    delete process.env.RESEND_API_KEY;

    expect(() => resolveResendApiKey()).toThrow(ResendAuthError);
    expect(() => resolveResendApiKey()).toThrow("RESEND_API_KEY");
  });

  it("uses the configured key, user agent, and a per-request override", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "list", has_more: false, data: [] }),
    );

    await runTool(resendEmailTools.resendListEmailsTool, {});
    expect(calls[0].headers.get("authorization")).toBe("Bearer re_test");
    expect(calls[0].headers.get("user-agent")).toBe(
      "bussiness-ops-resend-tools/1.0",
    );

    await runTool(
      resendEmailTools.resendListEmailsTool,
      {},
      {
        requestContext: {
          get: (key: string) => (key === "resendApiKey" ? "re_override" : undefined),
        },
      } as never,
    );
    expect(calls[1].headers.get("authorization")).toBe("Bearer re_override");
  });

  it("sends an email with mapped fields, attachments, and an idempotency key", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ id: "email-1" }));

    const result = await runTool(resendEmailTools.resendSendEmailTool, {
      from: "Acme <onboarding@example.com>",
      to: ["delivered@resend.dev"],
      subject: "Hello",
      html: "<p>Hello</p>",
      replyTo: "support@example.com",
      cc: ["cc@example.com"],
      bcc: "bcc@example.com",
      scheduledAt: "2026-08-05T11:52:01.858Z",
      topicId: "topic-1",
      tags: [{ name: "campaign", value: "welcome" }],
      headers: { "X-Custom": "yes" },
      attachments: [
        {
          content: "aGVsbG8=",
          filename: "hello.txt",
          contentType: "text/plain",
          contentId: "cid-1",
        },
      ],
      idempotencyKey: "send-1",
    });

    expect(result.id).toBe("email-1");
    expect(calls[0].url.pathname).toBe("/emails");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("idempotency-key")).toBe("send-1");
    expect(body(calls[0])).toEqual({
      attachments: [
        {
          content: "aGVsbG8=",
          filename: "hello.txt",
          content_type: "text/plain",
          content_id: "cid-1",
        },
      ],
      bcc: "bcc@example.com",
      cc: ["cc@example.com"],
      from: "Acme <onboarding@example.com>",
      headers: { "X-Custom": "yes" },
      html: "<p>Hello</p>",
      reply_to: "support@example.com",
      scheduled_at: "2026-08-05T11:52:01.858Z",
      subject: "Hello",
      tags: [{ name: "campaign", value: "welcome" }],
      to: ["delivered@resend.dev"],
      topic_id: "topic-1",
    });
  });

  it("validates email content modes", async () => {
    mockGoogleFetch(() => jsonResponse({ id: "email-1" }));

    await expect(
      runTool(resendEmailTools.resendSendEmailTool, {
        from: "a@example.com",
        to: "b@example.com",
        subject: "Nothing",
      }),
    ).rejects.toThrow("Provide one of html, text, or template");

    await expect(
      runTool(resendEmailTools.resendSendEmailTool, {
        from: "a@example.com",
        to: "b@example.com",
        subject: "Both",
        html: "<p>Hello</p>",
        template: { id: "template-1" },
      }),
    ).rejects.toThrow("either template or html/text");
  });

  it("sends a batch with permissive validation and idempotency", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ data: [{ id: "email-1" }, { id: "email-2" }] }),
    );

    const result = await runTool(resendEmailTools.resendSendBatchEmailsTool, {
      emails: [
        {
          from: "a@example.com",
          to: "one@example.com",
          subject: "One",
          text: "First",
        },
        {
          from: "a@example.com",
          to: "two@example.com",
          subject: "Two",
          html: "<p>Second</p>",
        },
      ],
      batchValidation: "permissive",
      idempotencyKey: "batch-1",
    });

    expect(result.data).toHaveLength(2);
    expect(calls[0].url.pathname).toBe("/emails/batch");
    expect(calls[0].headers.get("x-batch-validation")).toBe("permissive");
    expect(calls[0].headers.get("idempotency-key")).toBe("batch-1");
    expect(body(calls[0])).toHaveLength(2);
    expect(body(calls[0])[0]).toMatchObject({
      from: "a@example.com",
      to: "one@example.com",
      subject: "One",
      text: "First",
    });
  });

  it("lists, gets, updates, and cancels emails", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname === "/emails") {
        return jsonResponse({ object: "list", has_more: false, data: [] });
      }
      return jsonResponse({ object: "email", id: "email-1" });
    });

    await runTool(resendEmailTools.resendListEmailsTool, {
      limit: 2,
      after: "cursor-1",
    });
    expect(calls[0].url.searchParams.get("limit")).toBe("2");
    expect(calls[0].url.searchParams.get("after")).toBe("cursor-1");

    await runTool(resendEmailTools.resendGetEmailTool, { emailId: "email-1" });
    expect(calls[1].url.pathname).toBe("/emails/email-1");

    await runTool(resendEmailTools.resendUpdateEmailTool, {
      emailId: "email-1",
      scheduledAt: "in 2 hours",
    });
    expect(calls[2].method).toBe("PATCH");
    expect(body(calls[2])).toEqual({ scheduled_at: "in 2 hours" });

    await runTool(resendEmailTools.resendCancelEmailTool, { emailId: "email-1" });
    expect(calls[3].method).toBe("POST");
    expect(calls[3].url.pathname).toBe("/emails/email-1/cancel");
  });

  it("creates, lists, updates, verifies, and deletes domains", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "domain", id: "domain-1", deleted: true }),
    );

    await runTool(resendDomainTools.resendCreateDomainTool, {
      name: "example.com",
      region: "eu-west-1",
      customReturnPath: "bounce",
      openTracking: true,
      clickTracking: false,
      tls: "enforced",
      capabilities: { sending: "enabled", receiving: "disabled" },
      trackingSubdomain: "track",
    });
    expect(calls[0].url.pathname).toBe("/domains");
    expect(body(calls[0])).toEqual({
      name: "example.com",
      region: "eu-west-1",
      custom_return_path: "bounce",
      open_tracking: true,
      click_tracking: false,
      tls: "enforced",
      capabilities: { sending: "enabled", receiving: "disabled" },
      tracking_subdomain: "track",
    });

    await runTool(resendDomainTools.resendListDomainsTool, { limit: 5 });
    expect(calls[1].url.searchParams.get("limit")).toBe("5");

    await runTool(resendDomainTools.resendUpdateDomainTool, {
      domainId: "domain-1",
      openTracking: false,
      tls: "opportunistic",
    });
    expect(calls[2].method).toBe("PATCH");
    expect(body(calls[2])).toEqual({ open_tracking: false, tls: "opportunistic" });

    await runTool(resendDomainTools.resendVerifyDomainTool, { domainId: "domain-1" });
    expect(calls[3].url.pathname).toBe("/domains/domain-1/verify");

    await runTool(resendDomainTools.resendDeleteDomainTool, { domainId: "domain-1" });
    expect(calls[4].method).toBe("DELETE");
  });

  it("creates contacts with segments and topic subscriptions", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "contact", id: "contact-1" }),
    );

    await runTool(resendContactTools.resendCreateContactTool, {
      email: "steve@example.com",
      firstName: "Steve",
      lastName: "Wozniak",
      unsubscribed: false,
      properties: { plan: "pro", seats: 3 },
      segments: ["segment-1"],
      topics: [{ id: "topic-1", subscription: "opt_in" }],
    });

    expect(calls[0].url.pathname).toBe("/contacts");
    expect(body(calls[0])).toEqual({
      unsubscribed: false,
      email: "steve@example.com",
      first_name: "Steve",
      last_name: "Wozniak",
      properties: { plan: "pro", seats: 3 },
      segments: [{ id: "segment-1" }],
      topics: [{ id: "topic-1", subscription: "opt_in" }],
    });
  });

  it("gets, updates, and deletes contacts by ID or email", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "contact", id: "contact-1", deleted: true }),
    );

    await runTool(resendContactTools.resendGetContactTool, {
      email: "steve@example.com",
    });
    expect(calls[0].url.pathname).toBe("/contacts/steve@example.com");

    await runTool(resendContactTools.resendUpdateContactTool, {
      contactId: "contact-1",
      firstName: "Stephen",
      lastName: null,
      unsubscribed: true,
      properties: { plan: "enterprise", vip: true },
    });
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].url.pathname).toBe("/contacts/contact-1");
    expect(body(calls[1])).toEqual({
      first_name: "Stephen",
      last_name: null,
      unsubscribed: true,
      properties: { plan: "enterprise", vip: true },
    });

    await runTool(resendContactTools.resendDeleteContactTool, {
      contactId: "contact-1",
    });
    expect(calls[2].method).toBe("DELETE");
    expect(calls[2].url.pathname).toBe("/contacts/contact-1");
  });

  it("manages contact segment membership and topic subscriptions", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ id: "contact-1", deleted: false }),
    );

    await runTool(resendContactTools.resendAddContactToSegmentTool, {
      contactId: "contact-1",
      segmentId: "segment-1",
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/contacts/contact-1/segments/segment-1");

    await runTool(resendContactTools.resendRemoveContactFromSegmentTool, {
      email: "steve@example.com",
      segmentId: "segment-1",
    });
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url.pathname).toBe(
      "/contacts/steve@example.com/segments/segment-1",
    );

    await runTool(resendContactTools.resendListContactSegmentsTool, {
      contactId: "contact-1",
      limit: 10,
    });
    expect(calls[2].url.pathname).toBe("/contacts/contact-1/segments");
    expect(calls[2].url.searchParams.get("limit")).toBe("10");

    await runTool(resendContactTools.resendGetContactTopicsTool, {
      contactId: "contact-1",
    });
    expect(calls[3].url.pathname).toBe("/contacts/contact-1/topics");

    await runTool(resendContactTools.resendUpdateContactTopicsTool, {
      contactId: "contact-1",
      topics: [{ id: "topic-1", subscription: "opt_out" }],
    });
    expect(calls[4].method).toBe("PATCH");
    expect(body(calls[4])).toEqual([
      { id: "topic-1", subscription: "opt_out" },
    ]);
  });

  it("creates, lists, updates, and deletes segments", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "segment", id: "segment-1", deleted: true }),
    );

    await runTool(resendSegmentTools.resendCreateSegmentTool, { name: "VIP" });
    expect(body(calls[0])).toEqual({ name: "VIP" });

    await runTool(resendSegmentTools.resendListSegmentsTool, { before: "cursor-1" });
    expect(calls[1].url.searchParams.get("before")).toBe("cursor-1");

    await runTool(resendSegmentTools.resendGetSegmentTool, { segmentId: "segment-1" });
    expect(calls[2].url.pathname).toBe("/segments/segment-1");

    await runTool(resendSegmentTools.resendUpdateSegmentTool, {
      segmentId: "segment-1",
      name: "Customers",
    });
    expect(calls[3].method).toBe("PATCH");
    expect(body(calls[3])).toEqual({ name: "Customers" });

    await runTool(resendSegmentTools.resendDeleteSegmentTool, {
      segmentId: "segment-1",
    });
    expect(calls[4].method).toBe("DELETE");
  });

  it("creates, updates, and sends broadcasts", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "broadcast", id: "broadcast-1" }),
    );

    await runTool(resendBroadcastTools.resendCreateBroadcastTool, {
      name: "November announcements",
      segmentId: "segment-1",
      from: "Acme <news@example.com>",
      subject: "News",
      replyTo: "support@example.com",
      previewText: "What's new",
      html: "<p>News</p>",
      text: "News",
      topicId: "topic-1",
      send: false,
    });
    expect(calls[0].url.pathname).toBe("/broadcasts");
    expect(body(calls[0])).toEqual({
      name: "November announcements",
      segment_id: "segment-1",
      preview_text: "What's new",
      from: "Acme <news@example.com>",
      html: "<p>News</p>",
      reply_to: "support@example.com",
      subject: "News",
      text: "News",
      topic_id: "topic-1",
      send: false,
    });

    await runTool(resendBroadcastTools.resendUpdateBroadcastTool, {
      broadcastId: "broadcast-1",
      subject: "Updated",
      replyTo: "reply@example.com",
    });
    expect(calls[1].method).toBe("PATCH");
    expect(body(calls[1])).toEqual({
      subject: "Updated",
      reply_to: ["reply@example.com"],
    });

    await runTool(resendBroadcastTools.resendSendBroadcastTool, {
      broadcastId: "broadcast-1",
      scheduledAt: "in 1 day",
    });
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url.pathname).toBe("/broadcasts/broadcast-1/send");
    expect(body(calls[2])).toEqual({ scheduled_at: "in 1 day" });
  });

  it("creates, updates, publishes, duplicates, and deletes templates", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "template", id: "template-1" }),
    );

    await runTool(resendTemplateTools.resendCreateTemplateTool, {
      name: "Welcome",
      alias: "welcome",
      from: "Acme <hello@example.com>",
      subject: "Welcome",
      replyTo: "support@example.com",
      html: "<p>Hello {{{NAME}}}</p>",
      text: "Hello",
      variables: [{ key: "NAME", type: "string", fallbackValue: "there" }],
    });
    expect(calls[0].url.pathname).toBe("/templates");
    expect(body(calls[0])).toEqual({
      name: "Welcome",
      subject: "Welcome",
      html: "<p>Hello {{{NAME}}}</p>",
      text: "Hello",
      alias: "welcome",
      from: "Acme <hello@example.com>",
      reply_to: "support@example.com",
      variables: [{ key: "NAME", type: "string", fallback_value: "there" }],
    });

    await runTool(resendTemplateTools.resendUpdateTemplateTool, {
      templateId: "template-1",
      subject: "Updated",
    });
    expect(calls[1].method).toBe("PATCH");
    expect(body(calls[1])).toEqual({ subject: "Updated" });

    await runTool(resendTemplateTools.resendPublishTemplateTool, {
      templateId: "template-1",
    });
    expect(calls[2].url.pathname).toBe("/templates/template-1/publish");

    await runTool(resendTemplateTools.resendDuplicateTemplateTool, {
      templateId: "template-1",
    });
    expect(calls[3].url.pathname).toBe("/templates/template-1/duplicate");

    await runTool(resendTemplateTools.resendDeleteTemplateTool, {
      templateId: "template-1",
    });
    expect(calls[4].method).toBe("DELETE");
  });

  it("creates, updates, and deletes webhooks", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "webhook", id: "webhook-1", deleted: true }),
    );

    await runTool(resendWebhookTools.resendCreateWebhookTool, {
      endpoint: "https://example.com/webhooks/resend",
      events: ["email.delivered", "email.bounced"],
    });
    expect(calls[0].url.pathname).toBe("/webhooks");
    expect(body(calls[0])).toEqual({
      endpoint: "https://example.com/webhooks/resend",
      events: ["email.delivered", "email.bounced"],
    });

    await runTool(resendWebhookTools.resendUpdateWebhookTool, {
      webhookId: "webhook-1",
      status: "disabled",
      events: ["email.sent"],
    });
    expect(calls[1].method).toBe("PATCH");
    expect(body(calls[1])).toEqual({
      status: "disabled",
      events: ["email.sent"],
    });

    await runTool(resendWebhookTools.resendDeleteWebhookTool, {
      webhookId: "webhook-1",
    });
    expect(calls[2].method).toBe("DELETE");
  });

  it("creates, updates, and deletes topics", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ object: "topic", id: "topic-1", deleted: true }),
    );

    await runTool(resendTopicTools.resendCreateTopicTool, {
      name: "Newsletter",
      defaultSubscription: "opt_in",
      description: "Product news",
      visibility: "public",
    });
    expect(calls[0].url.pathname).toBe("/topics");
    expect(body(calls[0])).toEqual({
      name: "Newsletter",
      description: "Product news",
      visibility: "public",
      default_subscription: "opt_in",
    });

    await runTool(resendTopicTools.resendUpdateTopicTool, {
      topicId: "topic-1",
      name: "Updates",
      visibility: "private",
    });
    expect(calls[1].method).toBe("PATCH");
    expect(body(calls[1])).toEqual({
      id: "topic-1",
      name: "Updates",
      visibility: "private",
    });

    await runTool(resendTopicTools.resendDeleteTopicTool, { topicId: "topic-1" });
    expect(calls[2].method).toBe("DELETE");
  });

  it("rejects both pagination cursors at once", async () => {
    mockGoogleFetch(() => jsonResponse({ object: "list", data: [] }));

    await expect(
      runTool(resendEmailTools.resendListEmailsTool, {
        after: "cursor-1",
        before: "cursor-2",
      }),
    ).rejects.toThrow("either `after` or `before`");
  });

  it("surfaces Resend API errors with status and code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGoogleFetch(() =>
      jsonResponse(
        {
          statusCode: 401,
          name: "restricted_api_key",
          message: "This API key is restricted to only send emails",
        },
        401,
      ),
    );

    try {
      await runTool(resendEmailTools.resendListEmailsTool, {});
      throw new Error("Expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ResendApiError);
      const apiError = error as ResendApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.code).toBe("restricted_api_key");
      expect(apiError.message).toContain("restricted_api_key");
    }
  });
});
