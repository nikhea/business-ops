import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import {
  hubspotListSchema,
  hubspotObjectSchema,
  hubspotRecordListSchema,
} from "./hubspot-shared";

const objectTypeSchema = z
  .string()
  .min(1)
  .describe("Object type, e.g. deals, tickets, or a custom object type ID");

function pipelinePath(objectType: string, pipelineId?: string, stages = false): string {
  const base = `/crm/v3/pipelines/${encodeURIComponent(objectType)}`;
  if (!pipelineId) return base;
  return `${base}/${encodeURIComponent(pipelineId)}${stages ? "/stages" : ""}`;
}

export const hubspotListPipelinesTool = createTool({
  id: "hubspot_list_pipelines",
  title: "HubSpot: list pipelines",
  description: "List every pipeline and its stages for an object type, such as deals or tickets.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
  }),
  outputSchema: hubspotListSchema,
  execute: async ({ objectType }, { requestContext }) => {
    return hubspotRequest(pipelinePath(objectType), {
      authContext: { requestContext },
    });
  },
});

export const hubspotGetPipelineTool = createTool({
  id: "hubspot_get_pipeline",
  title: "HubSpot: get pipeline",
  description: "Retrieve one pipeline and its stages by pipeline ID.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
    pipelineId: z.string().min(1).describe("Pipeline ID"),
  }),
  outputSchema: hubspotObjectSchema,
  execute: async ({ objectType, pipelineId }, { requestContext }) => {
    return hubspotRequest(pipelinePath(objectType, pipelineId), {
      authContext: { requestContext },
    });
  },
});

export const hubspotListPipelineStagesTool = createTool({
  id: "hubspot_list_pipeline_stages",
  title: "HubSpot: list pipeline stages",
  description: "List the stages in one pipeline.",
  inputSchema: z.object({
    objectType: objectTypeSchema,
    pipelineId: z.string().min(1).describe("Pipeline ID"),
  }),
  outputSchema: hubspotRecordListSchema,
  execute: async ({ objectType, pipelineId }, { requestContext }) => {
    return hubspotRequest(pipelinePath(objectType, pipelineId, true), {
      authContext: { requestContext },
    });
  },
});

export const hubspotPipelineTools = {
  hubspotListPipelinesTool,
  hubspotGetPipelineTool,
  hubspotListPipelineStagesTool,
};
