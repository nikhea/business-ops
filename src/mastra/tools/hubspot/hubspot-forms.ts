import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import { hubspotRecordListSchema, hubspotRecordSchema } from "./hubspot-shared";

const formIdSchema = z.string().min(1).describe("HubSpot form ID (form GUID)");

export const hubspotListFormsTool = createTool({
  id: "hubspot_list_forms",
  title: "HubSpot: list forms",
  description: "List marketing forms with optional name and form type filters.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
    name: z.string().optional().describe("Filter by form name"),
    formType: z.string().optional().describe("Filter by form type, e.g. HUBSPOT or CAPTURED"),
    archived: z.boolean().optional().describe("Include archived forms"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ limit, after, name, formType, archived }, { requestContext }) => {
    return hubspotRequest("/marketing/v3/forms", {
      query: { limit, after, name, formType, archived },
      authContext: { requestContext },
    });
  },
});

export const hubspotGetFormTool = createTool({
  id: "hubspot_get_form",
  title: "HubSpot: get form",
  description: "Retrieve one marketing form and its fields by form ID.",
  inputSchema: z.object({
    formId: formIdSchema,
  }),
  outputSchema: hubspotRecordSchema,
  execute: async ({ formId }, { requestContext }) => {
    return hubspotRequest(`/marketing/v3/forms/${encodeURIComponent(formId)}`, {
      authContext: { requestContext },
    });
  },
});

export const hubspotListFormSubmissionsTool = createTool({
  id: "hubspot_list_form_submissions",
  title: "HubSpot: list form submissions",
  description: "List submissions for a marketing form, newest first.",
  inputSchema: z.object({
    formId: formIdSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10)
      .describe("Items per page (1-100)"),
    after: z.string().optional().describe("Cursor from a previous response"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ formId, limit, after }, { requestContext }) => {
    return hubspotRequest(
      `/form-integrations/v1/submissions/forms/${encodeURIComponent(formId)}`,
      {
        query: { limit, after },
        authContext: { requestContext },
      },
    );
  },
});

export const hubspotFormTools = {
  hubspotListFormsTool,
  hubspotGetFormTool,
  hubspotListFormSubmissionsTool,
};
