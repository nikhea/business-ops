import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const domainCapabilitiesSchema = z.object({
  sending: z.enum(["enabled", "disabled"]).optional().describe("Enable sending"),
  receiving: z.enum(["enabled", "disabled"]).optional().describe("Enable receiving"),
});

const domainRegionSchema = z.enum([
  "us-east-1",
  "eu-west-1",
  "sa-east-1",
  "ap-northeast-1",
]);

export const resendCreateDomainTool = createTool({
  id: "resend_create_domain",
  title: "Resend: create domain",
  description:
    "Add a sending domain to Resend. The response includes the DNS records that must be configured before verification.",
  inputSchema: z.object({
    name: z.string().describe("Domain name, e.g. example.com"),
    region: domainRegionSchema.optional().describe("Sending region"),
    customReturnPath: z.string().optional().describe("Return-Path subdomain; defaults to 'send'"),
    openTracking: z.boolean().optional().describe("Enable open tracking"),
    clickTracking: z.boolean().optional().describe("Enable click tracking"),
    tls: z.enum(["opportunistic", "enforced"]).optional().describe("TLS mode"),
    capabilities: domainCapabilitiesSchema.optional().describe("Sending/receiving capabilities"),
    trackingSubdomain: z.string().optional().describe("Subdomain used for tracking"),
  }),
  outputSchema: resendRecordSchema,
  execute: async (input, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.domains.create(input));
  },
});

export const resendListDomainsTool = createTool({
  id: "resend_list_domains",
  title: "Resend: list domains",
  description: "List domains configured in Resend with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.domains.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetDomainTool = createTool({
  id: "resend_get_domain",
  title: "Resend: get domain",
  description: "Retrieve a domain and its DNS verification records.",
  inputSchema: z.object({
    domainId: z.string().describe("Domain ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ domainId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.domains.get(domainId));
  },
});

export const resendUpdateDomainTool = createTool({
  id: "resend_update_domain",
  title: "Resend: update domain",
  description: "Update tracking, TLS, or capability settings for a Resend domain.",
  inputSchema: z.object({
    domainId: z.string().describe("Domain ID"),
    openTracking: z.boolean().optional().describe("Enable open tracking"),
    clickTracking: z.boolean().optional().describe("Enable click tracking"),
    tls: z.enum(["opportunistic", "enforced"]).optional().describe("TLS mode"),
    capabilities: domainCapabilitiesSchema.optional().describe("Sending/receiving capabilities"),
    trackingSubdomain: z.string().optional().describe("Subdomain used for tracking"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ domainId, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.domains.update({ id: domainId, ...input }));
  },
});

export const resendDeleteDomainTool = createTool({
  id: "resend_delete_domain",
  title: "Resend: delete domain",
  description: "Remove a domain from Resend.",
  inputSchema: z.object({
    domainId: z.string().describe("Domain ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ domainId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.domains.remove(domainId));
  },
});

export const resendVerifyDomainTool = createTool({
  id: "resend_verify_domain",
  title: "Resend: verify domain",
  description: "Trigger DNS verification for a Resend domain.",
  inputSchema: z.object({
    domainId: z.string().describe("Domain ID"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ domainId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.domains.verify(domainId));
  },
});

export const resendDomainTools = {
  resendCreateDomainTool,
  resendListDomainsTool,
  resendGetDomainTool,
  resendUpdateDomainTool,
  resendDeleteDomainTool,
  resendVerifyDomainTool,
};
