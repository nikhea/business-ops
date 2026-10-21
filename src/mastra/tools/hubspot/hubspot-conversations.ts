import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotRecordListSchema, hubspotRecordSchema } from "./hubspot-shared";

const threadIdSchema = z.string().min(1).describe("Conversation thread ID");

export const hubspotListConversationThreadsTool = createTool({
  id: "hubspot_list_conversation_threads",
  title: "HubSpot: list conversation threads",
  description:
    "List conversations inbox threads with optional inbox, status, and sorting filters.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
    inboxId: z.string().optional().describe("Only return threads in this inbox"),
    status: z.string().optional().describe("Thread status, e.g. OPEN or CLOSED"),
    sort: z.string().optional().describe("Sort field, e.g. latestMessageTimestamp"),
    property: z
      .array(z.string())
      .optional()
      .describe("Only return these thread properties"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async (
    { limit, after, inboxId, status, sort, property },
    { requestContext },
  ) => {
    return hubspotRequest("/conversations/v3/conversations/threads", {
      query: { limit, after, inboxId, status, sort, property },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetConversationThreadTool = createTool({
  id: "hubspot_get_conversation_thread",
  title: "HubSpot: get conversation thread",
  description: "Retrieve one conversation thread by thread ID.",
  inputSchema: z.object({
    threadId: threadIdSchema,
    property: z
      .array(z.string())
      .optional()
      .describe("Only return these thread properties"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ threadId, property }, { requestContext }) => {
    return hubspotRequest(
      `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`,
      {
        query: { property },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotListConversationMessagesTool = createTool({
  id: "hubspot_list_conversation_messages",
  title: "HubSpot: list conversation messages",
  description: "List the messages in a conversation thread.",
  inputSchema: z.object({
    threadId: threadIdSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
    property: z
      .array(z.string())
      .optional()
      .describe("Only return these message properties"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ threadId, limit, after, property }, { requestContext }) => {
    return hubspotRequest(
      `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
      {
        query: { limit, after, property },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotGetConversationMessageTool = createTool({
  id: "hubspot_get_conversation_message",
  title: "HubSpot: get conversation message",
  description: "Retrieve one message from a conversation thread.",
  inputSchema: z.object({
    threadId: threadIdSchema,
    messageId: z.string().min(1).describe("Conversation message ID"),
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ threadId, messageId }, { requestContext }) => {
    return hubspotRequest(
      `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      { authContext: { requestContext } },
    );
  },
});

export const hubspotConversationTools = {
  hubspotListConversationThreadsTool,
  hubspotGetConversationThreadTool,
  hubspotListConversationMessagesTool,
  hubspotGetConversationMessageTool,
};
