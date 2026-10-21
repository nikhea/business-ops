import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CreateBroadcastOptions, UpdateBroadcastOptions } from "resend";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendMutationSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const replyToSchema = z.union([z.string(), z.array(z.string())]);

const broadcastFieldsSchema = z.object({
  name: z.string().optional().describe("Internal broadcast name"),
  segmentId: z.string().optional().describe("Segment ID to send to"),
  from: z.string().optional().describe("Sender address"),
  subject: z.string().optional().describe("Email subject"),
  replyTo: replyToSchema.optional().describe("Reply-to address or addresses"),
  previewText: z.string().optional().describe("Inbox preview text"),
  html: z.string().optional().describe("HTML body"),
  text: z.string().optional().describe("Plain-text body"),
  topicId: z.string().nullable().optional().describe("Topic ID used to scope the broadcast"),
});

export const resendCreateBroadcastTool = createTool({
  id: "resend_create_broadcast",
  title: "Resend: create broadcast",
  description:
    "Create a marketing broadcast for a segment. Set send=true to send immediately or schedule it.",
  inputSchema: broadcastFieldsSchema
    .extend({
      segmentId: z.string().describe("Segment ID to send to"),
      from: z.string().describe("Sender address"),
      subject: z.string().describe("Email subject"),
      html: z.string().optional().describe("HTML body"),
      text: z.string().optional().describe("Plain-text body"),
      send: z.boolean().optional().describe("Send immediately instead of saving a draft"),
      scheduledAt: z.string().optional().describe("ISO 8601 schedule time; requires send=true"),
    })
    .superRefine((value, ctx) => {
      if (!value.html && !value.text) {
        ctx.addIssue({
          code: "custom",
          message: "Provide html or text.",
          path: ["html"],
        });
      }

      if (value.scheduledAt && !value.send) {
        ctx.addIssue({
          code: "custom",
          message: "scheduledAt requires send=true.",
          path: ["scheduledAt"],
        });
      }
    }),
  outputSchema: resendRecordSchema,
  execute: async ({ ...input }, { requestContext }) => {
    if (!input.html && !input.text) {
      throw new Error("Provide html or text.");
    }

    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.broadcasts.create(input as CreateBroadcastOptions),
    );
  },
});

export const resendListBroadcastsTool = createTool({
  id: "resend_list_broadcasts",
  title: "Resend: list broadcasts",
  description: "List broadcasts with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.broadcasts.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetBroadcastTool = createTool({
  id: "resend_get_broadcast",
  title: "Resend: get broadcast",
  description: "Retrieve a single broadcast by ID.",
  inputSchema: z.object({
    broadcastId: z.string().describe("Broadcast ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ broadcastId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.broadcasts.get(broadcastId));
  },
});

export const resendUpdateBroadcastTool = createTool({
  id: "resend_update_broadcast",
  title: "Resend: update broadcast",
  description: "Update a draft broadcast's segment, sender, subject, content, or topic.",
  inputSchema: broadcastFieldsSchema.extend({
    broadcastId: z.string().describe("Broadcast ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ broadcastId, replyTo, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    const update = {
      ...input,
      ...(replyTo !== undefined
        ? { replyTo: typeof replyTo === "string" ? [replyTo] : replyTo }
        : {}),
    } as UpdateBroadcastOptions;

    return resendCall(() => client.broadcasts.update(broadcastId, update));
  },
});

export const resendDeleteBroadcastTool = createTool({
  id: "resend_delete_broadcast",
  title: "Resend: delete broadcast",
  description: "Delete a broadcast that is still in draft status.",
  inputSchema: z.object({
    broadcastId: z.string().describe("Broadcast ID"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ broadcastId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.broadcasts.remove(broadcastId));
  },
});

export const resendSendBroadcastTool = createTool({
  id: "resend_send_broadcast",
  title: "Resend: send broadcast",
  description: "Send a broadcast immediately or schedule it for later.",
  inputSchema: z.object({
    broadcastId: z.string().describe("Broadcast ID"),
    scheduledAt: z
      .string()
      .optional()
      .describe("ISO 8601 schedule time, or a natural-language delay such as 'in 2 days'"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ broadcastId, scheduledAt }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.broadcasts.send(broadcastId, { scheduledAt }),
    );
  },
});

export const resendBroadcastTools = {
  resendCreateBroadcastTool,
  resendListBroadcastsTool,
  resendGetBroadcastTool,
  resendUpdateBroadcastTool,
  resendDeleteBroadcastTool,
  resendSendBroadcastTool,
};
