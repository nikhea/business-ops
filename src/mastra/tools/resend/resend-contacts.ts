import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type {
  ListContactSegmentsOptions,
  ListContactTopicsOptions,
  UpdateContactOptions,
} from "resend";
import { createResendClient, resendCall } from "./resend-auth";
import {
  contactSelector,
  contactSelectorObject,
  contactSelectorSchema,
  paginationOptions,
  resendListSchema,
  resendMutationSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const contactCreatePropertiesSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.null()]))
  .describe("Custom contact properties keyed by property key");

const contactUpdatePropertiesSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .describe("Custom contact properties keyed by property key");

const topicSubscriptionSchema = z.object({
  id: z.string().describe("Topic ID"),
  subscription: z.enum(["opt_in", "opt_out"]).describe("Subscription state"),
});

export const resendCreateContactTool = createTool({
  id: "resend_create_contact",
  title: "Resend: create contact",
  description:
    "Create a contact, optionally adding it to segments or setting topic subscriptions.",
  inputSchema: z.object({
    email: z.string().email().describe("Contact email address"),
    firstName: z.string().optional().describe("First name"),
    lastName: z.string().optional().describe("Last name"),
    unsubscribed: z.boolean().optional().describe("Unsubscribe from all broadcasts"),
    properties: contactCreatePropertiesSchema.optional(),
    segments: z.array(z.string()).optional().describe("Segment IDs to add the contact to"),
    topics: z.array(topicSubscriptionSchema).optional().describe("Topic subscriptions"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ segments, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.contacts.create({
        ...input,
        segments: segments?.map((id) => ({ id })),
      }),
    );
  },
});

export const resendListContactsTool = createTool({
  id: "resend_list_contacts",
  title: "Resend: list contacts",
  description: "List contacts, optionally filtered by segment, with cursor pagination.",
  inputSchema: resendPaginationSchema.extend({
    segmentId: z.string().optional().describe("Only return contacts in this segment"),
  }),
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before, segmentId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.contacts.list({
        ...paginationOptions({ limit, after, before }),
        segmentId,
      }),
    );
  },
});

export const resendGetContactTool = createTool({
  id: "resend_get_contact",
  title: "Resend: get contact",
  description: "Retrieve a contact by ID or email address.",
  inputSchema: contactSelectorSchema,
  outputSchema: resendRecordSchema,
  execute: async ({ contactId, email }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.contacts.get(contactSelector({ contactId, email })),
    );
  },
});

export const resendUpdateContactTool = createTool({
  id: "resend_update_contact",
  title: "Resend: update contact",
  description:
    "Update a contact's name, email, global subscription, or custom properties. Use null to clear a name.",
  inputSchema: contactSelectorSchema.extend({
    firstName: z.string().nullable().optional().describe("First name; null clears it"),
    lastName: z.string().nullable().optional().describe("Last name; null clears it"),
    unsubscribed: z.boolean().optional().describe("Unsubscribe from all broadcasts"),
    properties: contactUpdatePropertiesSchema.optional(),
  }),
  outputSchema: resendRecordSchema,
  execute: async (
    { contactId, email, firstName, lastName, unsubscribed, properties },
    { requestContext },
  ) => {
    const client = createResendClient({ requestContext });
    const update = {
      ...contactSelectorObject({ contactId, email }),
      firstName,
      lastName,
      unsubscribed,
      properties,
    } as UpdateContactOptions;

    return resendCall(() => client.contacts.update(update));
  },
});

export const resendDeleteContactTool = createTool({
  id: "resend_delete_contact",
  title: "Resend: delete contact",
  description: "Permanently delete a contact by ID or email address.",
  inputSchema: contactSelectorSchema,
  outputSchema: resendMutationSchema,
  execute: async ({ contactId, email }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.contacts.remove(contactSelector({ contactId, email })),
    );
  },
});

export const resendAddContactToSegmentTool = createTool({
  id: "resend_add_contact_to_segment",
  title: "Resend: add contact to segment",
  description: "Add an existing contact to a segment.",
  inputSchema: contactSelectorSchema.extend({
    segmentId: z.string().describe("Segment ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ contactId, email, segmentId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    const selector = contactId ? { contactId } : { email: email as string };

    if (!contactId && !email) {
      throw new Error("Provide contactId or email.");
    }

    return resendCall(() =>
      client.contacts.segments.add({ ...selector, segmentId }),
    );
  },
});

export const resendRemoveContactFromSegmentTool = createTool({
  id: "resend_remove_contact_from_segment",
  title: "Resend: remove contact from segment",
  description: "Remove a contact from a segment without deleting the contact.",
  inputSchema: contactSelectorSchema.extend({
    segmentId: z.string().describe("Segment ID"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ contactId, email, segmentId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    const selector = contactId ? { contactId } : { email: email as string };

    if (!contactId && !email) {
      throw new Error("Provide contactId or email.");
    }

    return resendCall(() =>
      client.contacts.segments.remove({ ...selector, segmentId }),
    );
  },
});

export const resendListContactSegmentsTool = createTool({
  id: "resend_list_contact_segments",
  title: "Resend: list contact segments",
  description: "List the segments a contact belongs to.",
  inputSchema: contactSelectorSchema.merge(resendPaginationSchema),
  outputSchema: resendListSchema,
  execute: async (
    { contactId, email, limit, after, before },
    { requestContext },
  ) => {
    const client = createResendClient({ requestContext });
    const selector = contactId ? { contactId } : { email: email as string };

    if (!contactId && !email) {
      throw new Error("Provide contactId or email.");
    }

    return resendCall(() =>
      client.contacts.segments.list({
        ...selector,
        ...paginationOptions({ limit, after, before }),
      } as ListContactSegmentsOptions),
    );
  },
});

export const resendGetContactTopicsTool = createTool({
  id: "resend_get_contact_topics",
  title: "Resend: get contact topics",
  description: "List a contact's topic subscriptions.",
  inputSchema: contactSelectorSchema.merge(resendPaginationSchema),
  outputSchema: resendListSchema,
  execute: async (
    { contactId, email, limit, after, before },
    { requestContext },
  ) => {
    const client = createResendClient({ requestContext });
    const selector = contactId ? { id: contactId } : { email: email as string };

    if (!contactId && !email) {
      throw new Error("Provide contactId or email.");
    }

    return resendCall(() =>
      client.contacts.topics.list({
        ...selector,
        ...paginationOptions({ limit, after, before }),
      } as ListContactTopicsOptions),
    );
  },
});

export const resendUpdateContactTopicsTool = createTool({
  id: "resend_update_contact_topics",
  title: "Resend: update contact topics",
  description: "Set opt-in or opt-out subscriptions for one or more topics.",
  inputSchema: contactSelectorSchema.extend({
    topics: z.array(topicSubscriptionSchema).min(1).describe("Topic subscriptions to set"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ contactId, email, topics }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    const selector = contactId ? { id: contactId } : { email: email as string };

    if (!contactId && !email) {
      throw new Error("Provide contactId or email.");
    }

    return resendCall(() =>
      client.contacts.topics.update({ ...selector, topics }),
    );
  },
});

export const resendContactTools = {
  resendCreateContactTool,
  resendListContactsTool,
  resendGetContactTool,
  resendUpdateContactTool,
  resendDeleteContactTool,
  resendAddContactToSegmentTool,
  resendRemoveContactFromSegmentTool,
  resendListContactSegmentsTool,
  resendGetContactTopicsTool,
  resendUpdateContactTopicsTool,
};
