import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendMutationSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

export const resendCreateSegmentTool = createTool({
  id: "resend_create_segment",
  title: "Resend: create segment",
  description: "Create a segment for organizing contacts and targeting broadcasts.",
  inputSchema: z.object({
    name: z.string().describe("Segment name"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ name }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.segments.create({ name }));
  },
});

export const resendListSegmentsTool = createTool({
  id: "resend_list_segments",
  title: "Resend: list segments",
  description: "List contact segments with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.segments.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetSegmentTool = createTool({
  id: "resend_get_segment",
  title: "Resend: get segment",
  description: "Retrieve a contact segment by ID.",
  inputSchema: z.object({
    segmentId: z.string().describe("Segment ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ segmentId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.segments.get(segmentId));
  },
});

export const resendUpdateSegmentTool = createTool({
  id: "resend_update_segment",
  title: "Resend: update segment",
  description: "Rename a contact segment.",
  inputSchema: z.object({
    segmentId: z.string().describe("Segment ID"),
    name: z.string().describe("New segment name"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ segmentId, name }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.segments.update(segmentId, { name }));
  },
});

export const resendDeleteSegmentTool = createTool({
  id: "resend_delete_segment",
  title: "Resend: delete segment",
  description: "Delete a contact segment. Contacts in the segment are not deleted.",
  inputSchema: z.object({
    segmentId: z.string().describe("Segment ID"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ segmentId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.segments.remove(segmentId));
  },
});

export const resendSegmentTools = {
  resendCreateSegmentTool,
  resendListSegmentsTool,
  resendGetSegmentTool,
  resendUpdateSegmentTool,
  resendDeleteSegmentTool,
};
