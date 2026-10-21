import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CreateBatchEmailOptions, CreateEmailOptions } from "resend";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const addressListSchema = z.union([z.string(), z.array(z.string())]);

const attachmentSchema = z.object({
  content: z.string().optional().describe("Base64-encoded file content"),
  filename: z.string().optional().describe("Attachment filename"),
  path: z.string().optional().describe("Public URL from which to fetch the file"),
  contentType: z.string().optional().describe("MIME type, e.g. application/pdf"),
  contentId: z.string().optional().describe("Content ID for inline images (cid: references)"),
});

const tagSchema = z.object({
  name: z.string().describe("Tag name"),
  value: z.string().describe("Tag value"),
});

const templateSchema = z.object({
  id: z.string().describe("Published template ID or alias"),
  variables: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe("Template variables"),
});

const emailBodySchema = z.object({
  from: z.string().describe("Sender, e.g. Acme <onboarding@example.com>"),
  to: addressListSchema.describe("Recipient address or addresses (max 50)"),
  subject: z.string().describe("Email subject"),
  bcc: addressListSchema.optional().describe("Bcc recipient address or addresses"),
  cc: addressListSchema.optional().describe("Cc recipient address or addresses"),
  replyTo: addressListSchema.optional().describe("Reply-to address or addresses"),
  html: z.string().optional().describe("HTML body"),
  text: z.string().optional().describe("Plain-text body"),
  template: templateSchema.optional().describe("Published template to render"),
  headers: z.record(z.string(), z.string()).optional().describe("Custom email headers"),
  scheduledAt: z
    .string()
    .optional()
    .describe("ISO 8601 send time, or a natural-language delay such as 'in 1 min'"),
  tags: z.array(tagSchema).optional().describe("Custom key/value tags"),
  topicId: z.string().optional().describe("Topic ID used to scope the send"),
  attachments: z.array(attachmentSchema).max(40).optional().describe("Attachments (max 40MB total)"),
});

export type EmailBodyInput = z.infer<typeof emailBodySchema>;

function toEmailOptions(input: EmailBodyInput): CreateEmailOptions {
  const hasContent = Boolean(input.html || input.text || input.template);

  if (!hasContent) {
    throw new Error("Provide one of html, text, or template.");
  }

  if (input.template && (input.html || input.text)) {
    throw new Error("Use either template or html/text, not both.");
  }

  return {
    from: input.from,
    to: input.to,
    subject: input.subject,
    bcc: input.bcc,
    cc: input.cc,
    replyTo: input.replyTo,
    html: input.html,
    text: input.text,
    template: input.template,
    headers: input.headers,
    scheduledAt: input.scheduledAt,
    tags: input.tags,
    topicId: input.topicId,
    attachments: input.attachments?.map((attachment) => ({
      content: attachment.content,
      filename: attachment.filename,
      path: attachment.path,
      contentType: attachment.contentType,
      contentId: attachment.contentId,
    })),
  } as CreateEmailOptions;
}

function toBatchEmailOptions(input: EmailBodyInput): CreateBatchEmailOptions {
  const { attachments: _attachments, ...withoutAttachments } = input;
  return toEmailOptions(withoutAttachments) as CreateBatchEmailOptions;
}

export const resendSendEmailTool = createTool({
  id: "resend_send_email",
  title: "Resend: send email",
  description:
    "Send a transactional email through Resend using HTML, plain text, or a published template. " +
    "Supports scheduling, attachments, tags, custom headers, reply-to, and idempotency keys.",
  inputSchema: emailBodySchema.extend({
    idempotencyKey: z
      .string()
      .max(256)
      .optional()
      .describe("Unique key that prevents duplicate sends for 24 hours"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ idempotencyKey, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.emails.send(toEmailOptions(input), { idempotencyKey }),
    );
  },
});

export const resendSendBatchEmailsTool = createTool({
  id: "resend_send_batch_emails",
  title: "Resend: send batch emails",
  description:
    "Send up to 100 personalized emails in one Resend batch call. Attachments are not supported in batches.",
  inputSchema: z.object({
    emails: z.array(emailBodySchema).min(1).max(100).describe("Emails to send (max 100)"),
    idempotencyKey: z
      .string()
      .max(256)
      .optional()
      .describe("Unique key that prevents duplicate batch sends for 24 hours"),
    batchValidation: z
      .enum(["strict", "permissive"])
      .optional()
      .describe("Strict fails the batch on one bad email; permissive returns per-email errors"),
  }),
  outputSchema: resendListSchema,
  execute: async (
    { emails, idempotencyKey, batchValidation },
    { requestContext },
  ) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.batch.send(emails.map(toBatchEmailOptions), {
        idempotencyKey,
        batchValidation,
      }),
    );
  },
});

export const resendListEmailsTool = createTool({
  id: "resend_list_emails",
  title: "Resend: list emails",
  description: "List recently sent emails with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.emails.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetEmailTool = createTool({
  id: "resend_get_email",
  title: "Resend: get email",
  description: "Retrieve a single sent email by ID, including its last delivery event.",
  inputSchema: z.object({
    emailId: z.string().describe("Email ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ emailId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.emails.get(emailId));
  },
});

export const resendUpdateEmailTool = createTool({
  id: "resend_update_email",
  title: "Resend: update scheduled email",
  description: "Change the scheduled send time of an email that has not been sent yet.",
  inputSchema: z.object({
    emailId: z.string().describe("Email ID"),
    scheduledAt: z.string().describe("New ISO 8601 send time or natural-language delay"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ emailId, scheduledAt }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.emails.update({ id: emailId, scheduledAt }),
    );
  },
});

export const resendCancelEmailTool = createTool({
  id: "resend_cancel_email",
  title: "Resend: cancel email",
  description: "Cancel a scheduled email before it is sent.",
  inputSchema: z.object({
    emailId: z.string().describe("Email ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ emailId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.emails.cancel(emailId));
  },
});

export const resendEmailTools = {
  resendSendEmailTool,
  resendSendBatchEmailsTool,
  resendListEmailsTool,
  resendGetEmailTool,
  resendUpdateEmailTool,
  resendCancelEmailTool,
};
