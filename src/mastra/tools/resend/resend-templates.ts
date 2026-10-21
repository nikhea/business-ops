import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CreateTemplateOptions, UpdateTemplateOptions } from "resend";
import { createResendClient, resendCall } from "./resend-auth";
import {
  paginationOptions,
  resendListSchema,
  resendMutationSchema,
  resendPaginationSchema,
  resendRecordSchema,
} from "./resend-shared";

const variableSchema = z.object({
  key: z.string().describe("Variable key"),
  type: z.enum(["string", "number"]).describe("Variable type"),
  fallbackValue: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .describe("Fallback value used when a send does not provide one"),
});

const replyToSchema = z.union([z.string(), z.array(z.string())]);

const templateFieldsSchema = z.object({
  name: z.string().optional().describe("Template name"),
  alias: z.string().optional().describe("Template alias"),
  from: z.string().optional().describe("Default sender address"),
  subject: z.string().optional().describe("Default subject"),
  replyTo: replyToSchema.optional().describe("Default reply-to address or addresses"),
  html: z.string().optional().describe("HTML template body"),
  text: z.string().optional().describe("Plain-text template body"),
  variables: z.array(variableSchema).optional().describe("Template variables"),
});

export const resendCreateTemplateTool = createTool({
  id: "resend_create_template",
  title: "Resend: create template",
  description:
    "Create a reusable email template with optional variables. Publish it before sending by template ID or alias.",
  inputSchema: templateFieldsSchema.extend({
    name: z.string().describe("Template name"),
    html: z.string().describe("HTML template body"),
  }),
  outputSchema: resendRecordSchema,
  execute: async (input, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.templates.create(input as CreateTemplateOptions),
    );
  },
});

export const resendListTemplatesTool = createTool({
  id: "resend_list_templates",
  title: "Resend: list templates",
  description: "List email templates with cursor-based pagination.",
  inputSchema: resendPaginationSchema,
  outputSchema: resendListSchema,
  execute: async ({ limit, after, before }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.templates.list(paginationOptions({ limit, after, before })),
    );
  },
});

export const resendGetTemplateTool = createTool({
  id: "resend_get_template",
  title: "Resend: get template",
  description: "Retrieve a template by ID or alias.",
  inputSchema: z.object({
    templateId: z.string().describe("Template ID or alias"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ templateId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.templates.get(templateId));
  },
});

export const resendUpdateTemplateTool = createTool({
  id: "resend_update_template",
  title: "Resend: update template",
  description: "Update a template's content, metadata, or variables.",
  inputSchema: templateFieldsSchema.extend({
    templateId: z.string().describe("Template ID or alias"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ templateId, ...input }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() =>
      client.templates.update(templateId, input as UpdateTemplateOptions),
    );
  },
});

export const resendDeleteTemplateTool = createTool({
  id: "resend_delete_template",
  title: "Resend: delete template",
  description: "Delete a template by ID or alias.",
  inputSchema: z.object({
    templateId: z.string().describe("Template ID or alias"),
  }),
  outputSchema: resendMutationSchema,
  execute: async ({ templateId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.templates.remove(templateId));
  },
});

export const resendPublishTemplateTool = createTool({
  id: "resend_publish_template",
  title: "Resend: publish template",
  description: "Publish the current version of a template so it can be used in sends.",
  inputSchema: z.object({
    templateId: z.string().describe("Template ID or alias"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ templateId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.templates.publish(templateId));
  },
});

export const resendDuplicateTemplateTool = createTool({
  id: "resend_duplicate_template",
  title: "Resend: duplicate template",
  description: "Create a copy of an existing template.",
  inputSchema: z.object({
    templateId: z.string().describe("Template ID or alias"),
  }),
  outputSchema: resendRecordSchema,
  execute: async ({ templateId }, { requestContext }) => {
    const client = createResendClient({ requestContext });
    return resendCall(() => client.templates.duplicate(templateId));
  },
});

export const resendTemplateTools = {
  resendCreateTemplateTool,
  resendListTemplatesTool,
  resendGetTemplateTool,
  resendUpdateTemplateTool,
  resendDeleteTemplateTool,
  resendPublishTemplateTool,
  resendDuplicateTemplateTool,
};
