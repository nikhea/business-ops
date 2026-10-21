import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CreateTopicOptions, UpdateTopicOptions } from "resend";
import { createResendClient, resendCall } from "./resend-auth";
import {
  resendListSchema,
  resendMutationSchema,
  resendRecordSchema,
} from "./resend-shared";

const visibilitySchema = z
  .enum(["public", "private"])
  .optional()
  .describe("Public topics appear on the unsubscribe page; private ones do not");

export const resendCreateTopicTool = createTool({
  id: "resend_create_topic",
  title: "Resend: create topic",
  description:
    "Create an email topic for subscription preferences. The default subscription cannot be changed later.",
  inputSchema: z.object({
    name: z.string().max(50).describe("Topic name (max 50 characters)"),
    defaultSubscription: z
      .enum(["opt_in", "opt_out"])
      .describe("Default subscription state for contacts"),
    description: z.string().max(200).optional().describe("Topic description (max 200 characters)"),
    visibility: visibilitySchema,
  }),
  outputSchema: resendRecordSchema,
  execute: async (input, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.topics.create(input as CreateTopicOptions),
    );
  },
});

export const resendListTopicsTool = createTool({
  id: "resend_list_topics",
  title: "Resend: list topics",
  description: "List all email topics for the team.",
  inputSchema: z.object({}),
  outputSchema: resendListSchema,
  execute: async (_input, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.topics.list());
  },
});

export const resendGetTopicTool = createTool({
  id: "resend_get_topic",
  title: "Resend: get topic",
  description: "Retrieve a topic by ID.",
  inputSchema: z.object({
    topicId: z.string().describe("Topic ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ topicId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.topics.get(topicId));
  },
});

export const resendUpdateTopicTool = createTool({
  id: "resend_update_topic",
  title: "Resend: update topic",
  description: "Update a topic's name, description, or visibility.",
  inputSchema: z.object({
    topicId: z.string().describe("Topic ID"),
    name: z.string().max(50).optional().describe("New name"),
    description: z.string().max(200).optional().describe("New description"),
    visibility: visibilitySchema,
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ topicId, ...input }, { requestContext }) => {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.visibility === undefined
    ) {
      throw new Error("Provide at least one of name, description, or visibility.");
    }

    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.topics.update({ id: topicId, ...input } as UpdateTopicOptions),
    );
  },
});

export const resendDeleteTopicTool = createTool({
  id: "resend_delete_topic",
  title: "Resend: delete topic",
  description: "Delete a topic by ID.",
  inputSchema: z.object({
    topicId: z.string().describe("Topic ID"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ topicId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.topics.remove(topicId));
  },
});

export const resendTopicTools = {
  resendCreateTopicTool,
  resendListTopicsTool,
  resendGetTopicTool,
  resendUpdateTopicTool,
  resendDeleteTopicTool,
};
