import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import { runTool } from "../../helpers/tool";
import {
  HubspotApiError,
  HubspotAuthError,
  resolveHubspotBaseUrl,
  resolveHubspotToken,
} from "../../../src/mastra/tools/hubspot/hubspot-auth";
import {
  hubspotContactTools,
  hubspotDealTools,
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

function body(call: { body?: string }) {
  return call.body ? JSON.parse(call.body) : undefined;
}

describe("hubspot tools", () => {
  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-eu1-test";
    process.env.HUBSPOT_BASE_URL = "https://api-eu1.hubapi.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    delete process.env.HUBSPOT_TOKEN;
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    delete process.env.HUBSPOT_BASE_URL;
  });

  it("throws a clear error when no token is configured", () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;

    expect(() => resolveHubspotToken()).toThrow(HubspotAuthError);
    expect(() => resolveHubspotToken()).toThrow("HUBSPOT_ACCESS_TOKEN");
  });

  it("uses the EU host for EU private app tokens and honors an override", () => {
    delete process.env.HUBSPOT_BASE_URL;
    expect(resolveHubspotBaseUrl("pat-eu1-abc")).toBe(
      "https://api-eu1.hubapi.com",
    );
    expect(resolveHubspotBaseUrl("pat-na1-abc")).toBe("https://api.hubapi.com");

    process.env.HUBSPOT_BASE_URL = "https://api.example.com/";
    expect(resolveHubspotBaseUrl("pat-eu1-abc")).toBe("https://api.example.com");
  });

  it("lists contacts with auth, user agent, and query parameters", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ id: "1", properties: { email: "a@example.com" } }] }),
    );

    const result = await runTool(hubspotContactTools.hubspotListContactsTool, {
      limit: 2,
      properties: ["email", "firstname"],
      associations: ["companies"],
    });

    expect(result.results[0].id).toBe("1");
    expect(calls[0].url.origin).toBe("https://api-eu1.hubapi.com");
    expect(calls[0].url.pathname).toBe("/crm/v3/objects/contacts");
    expect(calls[0].url.searchParams.get("limit")).toBe("2");
    expect(calls[0].url.searchParams.get("properties")).toBe("email,firstname");
    expect(calls[0].url.searchParams.get("associations")).toBe("companies");
    expect(calls[0].headers.get("authorization")).toBe("Bearer pat-eu1-test");
    expect(calls[0].headers.get("user-agent")).toBe(
      "bussiness-ops-hubspot-tools/1.0",
    );
  });

  it("supports a per-request token override", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ results: [] }));

    await runTool(
      hubspotContactTools.hubspotListContactsTool,
      {},
      {
        requestContext: {
          get: (key: string) =>
            key === "hubspotAccessToken" ? "pat-eu1-override" : undefined,
        },
      } as never,
    );

    expect(calls[0].headers.get("authorization")).toBe("Bearer pat-eu1-override");
  });

  it("searches contacts with filters, sorts, and properties", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ id: "1", properties: {} }] }),
    );

    await runTool(hubspotContactTools.hubspotSearchContactsTool, {
      filterGroups: [
        {
          filters: [
            { propertyName: "email", operator: "EQ", value: "a@example.com" },
          ],
        },
      ],
      sorts: [{ propertyName: "createdate", direction: "DESC" }],
      properties: ["email"],
      limit: 5,
    });

    expect(calls[0].url.pathname).toBe("/crm/v3/objects/contacts/search");
    expect(calls[0].method).toBe("POST");
    expect(body(calls[0])).toEqual({
      filterGroups: [
        {
          filters: [
            { propertyName: "email", operator: "EQ", value: "a@example.com" },
          ],
        },
      ],
      sorts: [{ propertyName: "createdate", direction: "DESC" }],
      properties: ["email"],
      limit: 5,
    });
  });

  it("creates, gets, updates, and deletes a contact", async () => {
    const { calls } = mockGoogleFetch(({ method }) =>
      method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ id: "1", properties: { email: "a@example.com" } }),
    );

    const created = await runTool(hubspotContactTools.hubspotCreateContactTool, {
      properties: { email: "a@example.com", firstname: "Ada" },
      associations: [
        {
          to: { id: "2" },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }],
        },
      ],
    });
    expect(created.id).toBe("1");
    expect(calls[0].method).toBe("POST");
    expect(body(calls[0])).toEqual({
      properties: { email: "a@example.com", firstname: "Ada" },
      associations: [
        {
          to: { id: "2" },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }],
        },
      ],
    });

    await runTool(hubspotContactTools.hubspotGetContactTool, {
      objectId: "1",
      properties: ["email"],
      idProperty: "email",
    });
    expect(calls[1].url.pathname).toBe("/crm/v3/objects/contacts/1");
    expect(calls[1].url.searchParams.get("properties")).toBe("email");
    expect(calls[1].url.searchParams.get("idProperty")).toBe("email");

    await runTool(hubspotContactTools.hubspotUpdateContactTool, {
      objectId: "1",
      properties: { firstname: "Grace" },
    });
    expect(calls[2].method).toBe("PATCH");
    expect(body(calls[2])).toEqual({ properties: { firstname: "Grace" } });

    const deleted = await runTool(hubspotContactTools.hubspotDeleteContactTool, {
      objectId: "1",
    });
    expect(deleted).toEqual({ archived: true, id: "1" });
    expect(calls[3].method).toBe("DELETE");
    expect(calls[3].url.pathname).toBe("/crm/v3/objects/contacts/1");
  });

  it("uses the generic object tools for deals", async () => {
    const { calls } = mockGoogleFetch(() => jsonResponse({ results: [] }));

    await runTool(hubspotDealTools.hubspotListDealsTool, {
      limit: 10,
      properties: ["dealname", "amount"],
    });

    expect(calls[0].url.pathname).toBe("/crm/v3/objects/deals");
    expect(calls[0].url.searchParams.get("properties")).toBe("dealname,amount");
  });

  it("lists owners and pipelines, and resolves pipeline stages", async () => {
    const { calls } = mockGoogleFetch(({ url }) => {
      if (url.pathname === "/crm/v3/owners") {
        return jsonResponse({ results: [{ id: "9", email: "owner@example.com" }] });
      }
      if (url.pathname.endsWith("/stages")) {
        return jsonResponse({ results: [{ id: "stage-1", label: "New" }] });
      }
      return jsonResponse({ results: [{ id: "default", label: "Sales" }] });
    });

    await runTool(hubspotOwnerTools.hubspotListOwnersTool, {
      limit: 5,
      email: "owner@example.com",
    });
    expect(calls[0].url.searchParams.get("email")).toBe("owner@example.com");

    await runTool(hubspotPipelineTools.hubspotListPipelinesTool, {
      objectType: "deals",
    });
    expect(calls[1].url.pathname).toBe("/crm/v3/pipelines/deals");

    await runTool(hubspotPipelineTools.hubspotListPipelineStagesTool, {
      objectType: "deals",
      pipelineId: "default",
    });
    expect(calls[2].url.pathname).toBe("/crm/v3/pipelines/deals/default/stages");
    expect(calls[2].url.pathname).toContain("/stages");
  });

  it("lists properties and property groups", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ name: "email", label: "Email" }] }),
    );

    await runTool(hubspotPropertyTools.hubspotListPropertiesTool, {
      objectType: "contacts",
      archived: true,
    });
    expect(calls[0].url.pathname).toBe("/crm/v3/properties/contacts");
    expect(calls[0].url.searchParams.get("archived")).toBe("true");

    await runTool(hubspotPropertyTools.hubspotListPropertyGroupsTool, {
      objectType: "contacts",
    });
    expect(calls[1].url.pathname).toBe("/crm/v3/properties/contacts/groups");
  });

  it("lists association labels and creates and deletes associations", async () => {
    const { calls } = mockGoogleFetch(({ method }) =>
      method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ results: [{ category: "HUBSPOT_DEFINED", typeId: 1 }] }),
    );

    await runTool(hubspotAssociationTools.hubspotListAssociationLabelsTool, {
      fromObjectType: "contacts",
      toObjectType: "companies",
    });
    expect(calls[0].url.pathname).toBe("/crm/v4/associations/contacts/companies/labels");

    await runTool(hubspotAssociationTools.hubspotCreateAssociationTool, {
      fromObjectType: "contacts",
      fromObjectId: "1",
      toObjectType: "companies",
      toObjectId: "2",
      associationCategory: "HUBSPOT_DEFINED",
      associationTypeId: 1,
    });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].url.pathname).toBe(
      "/crm/v4/objects/contacts/1/associations/companies/2",
    );
    expect(body(calls[1])).toEqual([
      { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 },
    ]);

    const result = await runTool(
      hubspotAssociationTools.hubspotDeleteAssociationTool,
      {
        fromObjectType: "contacts",
        fromObjectId: "1",
        toObjectType: "companies",
        toObjectId: "2",
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 1,
      },
    );
    expect(result).toEqual({ deleted: true });
    expect(calls[2].method).toBe("DELETE");
  });

  it("creates lists and manages memberships", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ listId: "list-1", name: "VIP" }),
    );

    await runTool(hubspotListTools.hubspotCreateListTool, {
      name: "VIP",
      objectTypeId: "0-1",
      processingType: "MANUAL",
    });
    expect(calls[0].url.pathname).toBe("/crm/v3/lists");
    expect(body(calls[0])).toEqual({
      name: "VIP",
      objectTypeId: "0-1",
      processingType: "MANUAL",
    });

    await runTool(hubspotListTools.hubspotAddListMembersTool, {
      listId: "list-1",
      recordIds: ["1", "2"],
    });
    expect(calls[1].url.pathname).toBe("/crm/v3/lists/list-1/memberships/add");
    expect(body(calls[1])).toEqual(["1", "2"]);

    await runTool(hubspotListTools.hubspotRemoveListMembersTool, {
      listId: "list-1",
      recordIds: ["2"],
    });
    expect(calls[2].url.pathname).toBe("/crm/v3/lists/list-1/memberships/remove");
    expect(body(calls[2])).toEqual(["2"]);
  });

  it("lists conversation threads and messages", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ id: "thread-1" }] }),
    );

    await runTool(hubspotConversationTools.hubspotListConversationThreadsTool, {
      limit: 5,
      status: "OPEN",
    });
    expect(calls[0].url.pathname).toBe("/conversations/v3/conversations/threads");
    expect(calls[0].url.searchParams.get("status")).toBe("OPEN");

    await runTool(hubspotConversationTools.hubspotListConversationMessagesTool, {
      threadId: "thread-1",
    });
    expect(calls[1].url.pathname).toBe(
      "/conversations/v3/conversations/threads/thread-1/messages",
    );
  });

  it("lists forms and form submissions", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ id: "form-1" }] }),
    );

    await runTool(hubspotFormTools.hubspotListFormsTool, { limit: 5 });
    expect(calls[0].url.pathname).toBe("/marketing/v3/forms");

    await runTool(hubspotFormTools.hubspotListFormSubmissionsTool, {
      formId: "form-1",
      limit: 5,
    });
    expect(calls[1].url.pathname).toBe(
      "/form-integrations/v1/submissions/forms/form-1",
    );
  });

  it("lists and gets marketing events", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ objectId: "event-1" }] }),
    );

    await runTool(hubspotMarketingEventTools.hubspotListMarketingEventsTool, {
      limit: 5,
    });
    expect(calls[0].url.pathname).toBe("/marketing/v3/marketing-events");

    await runTool(hubspotMarketingEventTools.hubspotGetMarketingEventTool, {
      objectId: "event-1",
    });
    expect(calls[1].url.pathname).toBe(
      "/marketing/v3/marketing-events/event-1",
    );
  });

  it("lists custom object schemas and records", async () => {
    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ results: [{ id: "2-123", name: "Machine" }] }),
    );

    await runTool(hubspotSchemaTools.hubspotListObjectSchemasTool, {});
    expect(calls[0].url.pathname).toBe("/crm/v3/schemas");

    await runTool(hubspotCustomObjectTools.hubspotListCustomObjectsTool, {
      objectType: "2-123",
      limit: 5,
    });
    expect(calls[1].url.pathname).toBe("/crm/v3/objects/2-123");
  });

  it("surfaces HubSpot API errors with status and correlation ID", async () => {
    mockGoogleFetch(() =>
      jsonResponse(
        {
          status: "error",
          message: "This app hasn't been granted all required scopes",
          category: "MISSING_SCOPES",
          correlationId: "corr-1",
        },
        403,
      ),
    );

    await expect(
      runTool(hubspotContactTools.hubspotListContactsTool, {}),
    ).rejects.toMatchObject({
      name: "HubspotApiError",
      status: 403,
      category: "MISSING_SCOPES",
      correlationId: "corr-1",
    });
    await expect(
      runTool(hubspotContactTools.hubspotListContactsTool, {}),
    ).rejects.toBeInstanceOf(HubspotApiError);
  });
});
