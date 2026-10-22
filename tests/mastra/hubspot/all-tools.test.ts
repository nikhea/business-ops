import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { toolContext } from "../../helpers/tool";
import {
  hubspotContactTools,
  hubspotCompanyTools,
  hubspotDealTools,
  hubspotTicketTools,
  hubspotLeadTools,
  hubspotQuoteTools,
  hubspotOrderTools,
  hubspotInvoiceTools,
  hubspotLineItemTools,
} from "../../../src/mastra/tools/hubspot/hubspot-objects";
import { hubspotCustomObjectTools } from "../../../src/mastra/tools/hubspot/hubspot-custom-objects";
import { hubspotOwnerTools } from "../../../src/mastra/tools/hubspot/hubspot-owners";
import { hubspotPipelineTools } from "../../../src/mastra/tools/hubspot/hubspot-pipelines";
import { hubspotPropertyTools } from "../../../src/mastra/tools/hubspot/hubspot-properties";
import { hubspotAssociationTools } from "../../../src/mastra/tools/hubspot/hubspot-associations";
import { hubspotListTools } from "../../../src/mastra/tools/hubspot/hubspot-lists";
import { hubspotConversationTools } from "../../../src/mastra/tools/hubspot/hubspot-conversations";
import { hubspotFormTools } from "../../../src/mastra/tools/hubspot/hubspot-forms";
import { hubspotMarketingEventTools } from "../../../src/mastra/tools/hubspot/hubspot-marketing-events";
import { hubspotSchemaTools } from "../../../src/mastra/tools/hubspot/hubspot-schemas";

const groups = [
  hubspotContactTools,
  hubspotCompanyTools,
  hubspotDealTools,
  hubspotTicketTools,
  hubspotLeadTools,
  hubspotQuoteTools,
  hubspotOrderTools,
  hubspotInvoiceTools,
  hubspotLineItemTools,
  hubspotCustomObjectTools,
  hubspotOwnerTools,
  hubspotPipelineTools,
  hubspotPropertyTools,
  hubspotAssociationTools,
  hubspotListTools,
  hubspotConversationTools,
  hubspotFormTools,
  hubspotMarketingEventTools,
  hubspotSchemaTools,
];

interface ToolLike {
  id: string;
  title: string;
  description: string;
  execute?: (...args: any[]) => any;
}

const tools = groups.flatMap((group) =>
  Object.values(group),
) as unknown as ToolLike[];

const specialInputs: Record<string, unknown> = {
  hubspot_list_custom_objects: { objectType: "2-123", limit: 1 },
  hubspot_search_custom_objects: { objectType: "2-123", limit: 1 },
  hubspot_get_custom_object: { objectType: "2-123", objectId: "1" },
  hubspot_create_custom_object: {
    objectType: "2-123",
    properties: { name: "Test" },
  },
  hubspot_update_custom_object: {
    objectType: "2-123",
    objectId: "1",
    properties: { name: "Test" },
  },
  hubspot_delete_custom_object: { objectType: "2-123", objectId: "1" },
  hubspot_list_owners: { limit: 1 },
  hubspot_get_owner: { ownerId: "1" },
  hubspot_list_pipelines: { objectType: "deals" },
  hubspot_get_pipeline: { objectType: "deals", pipelineId: "default" },
  hubspot_list_pipeline_stages: { objectType: "deals", pipelineId: "default" },
  hubspot_list_properties: { objectType: "contacts" },
  hubspot_get_property: { objectType: "contacts", propertyName: "email" },
  hubspot_list_property_groups: { objectType: "contacts" },
  hubspot_list_associations: {
    fromObjectType: "contacts",
    fromObjectId: "1",
    toObjectType: "companies",
  },
  hubspot_create_association: {
    fromObjectType: "contacts",
    fromObjectId: "1",
    toObjectType: "companies",
    toObjectId: "2",
    associationCategory: "HUBSPOT_DEFINED",
    associationTypeId: 1,
  },
  hubspot_delete_association: {
    fromObjectType: "contacts",
    fromObjectId: "1",
    toObjectType: "companies",
    toObjectId: "2",
    associationCategory: "HUBSPOT_DEFINED",
    associationTypeId: 1,
  },
  hubspot_list_association_labels: {
    fromObjectType: "contacts",
    toObjectType: "companies",
  },
  hubspot_list_lists: { limit: 1 },
  hubspot_get_list: { listId: "1" },
  hubspot_create_list: { name: "Test" },
  hubspot_update_list: { listId: "1", name: "Test" },
  hubspot_delete_list: { listId: "1" },
  hubspot_list_list_memberships: { listId: "1" },
  hubspot_add_list_members: { listId: "1", recordIds: ["1"] },
  hubspot_remove_list_members: { listId: "1", recordIds: ["1"] },
  hubspot_list_conversation_threads: { limit: 1 },
  hubspot_get_conversation_thread: { threadId: "1" },
  hubspot_list_conversation_messages: { threadId: "1" },
  hubspot_get_conversation_message: { threadId: "1", messageId: "1" },
  hubspot_list_forms: { limit: 1 },
  hubspot_get_form: { formId: "1" },
  hubspot_list_form_submissions: { formId: "1" },
  hubspot_list_marketing_events: { limit: 1 },
  hubspot_get_marketing_event: { objectId: "1" },
  hubspot_create_marketing_event: {
    externalAccountId: "account",
    externalEventId: "event",
    eventName: "Test",
    eventOrganizer: "Test",
  },
  hubspot_update_marketing_event: { objectId: "1", eventName: "Test" },
  hubspot_delete_marketing_event: { objectId: "1" },
  hubspot_list_object_schemas: {},
  hubspot_get_object_schema: { objectType: "2-123" },
};

function inputFor(id: string): unknown {
  if (id in specialInputs) return specialInputs[id];

  if (id.startsWith("hubspot_list_") || id.startsWith("hubspot_search_")) {
    return { limit: 1 };
  }

  if (id.startsWith("hubspot_get_") || id.startsWith("hubspot_delete_")) {
    return { objectId: "1" };
  }

  if (id.startsWith("hubspot_create_")) {
    return { properties: { name: "Test" } };
  }

  if (id.startsWith("hubspot_update_")) {
    return { objectId: "1", properties: { name: "Test" } };
  }

  throw new Error(`No test input for ${id}`);
}

describe("all hubspot tools", () => {
  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-eu1-test";
    process.env.HUBSPOT_BASE_URL = "https://api-eu1.hubapi.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    delete process.env.HUBSPOT_BASE_URL;
  });

  it("registers and executes every tool", async () => {
    expect(tools).toHaveLength(94);

    const { calls } = mockGoogleFetch(({ method }) =>
      method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({
            results: [],
            id: "1",
            listId: "1",
            objectId: "1",
            objectTypeId: "2-123",
            name: "Test",
          }),
    );

    for (const tool of tools) {
      expect(tool.id).toMatch(/^hubspot_/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.execute).toBeTypeOf("function");

      try {
        await tool.execute!(inputFor(tool.id), toolContext);
      } catch (error) {
        throw new Error(
          `${tool.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(calls).toHaveLength(94);
  });
});
