import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hubspotRequest } from "./hubspot-auth";
import {
  getQuery,
  hubspotAssociationInputSchema,
  hubspotListSchema,
  hubspotObjectGetSchema,
  hubspotObjectListSchema,
  hubspotObjectSchema,
  hubspotPropertiesSchema,
  hubspotRecordSchema,
  hubspotSearchSchema,
  listQuery,
  objectPath,
  searchBody,
} from "./hubspot-shared";

interface ObjectConfig {
  key: string;
  singular: string;
  label: string;
  description: string;
  suffix?: string;
  singularSuffix?: string;
}

function createHubspotObjectTools(config: ObjectConfig) {
  const { key, singular, label, description } = config;
  const suffix = config.suffix ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const singularSuffix =
    config.singularSuffix ??
    `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;

  const listTool = createTool({
    id: `hubspot_list_${key}`,
    title: `HubSpot: list ${label}`,
    description: `List ${label} with property selection and cursor pagination. ${description}`,
    inputSchema: hubspotObjectListSchema,
    outputSchema: hubspotListSchema,
    execute: async (input, { requestContext }) => {
      return hubspotRequest(`/crm/v3/objects/${key}`, {
        query: listQuery(input),
        authContext: { requestContext },
      });
    },
  });

  const searchTool = createTool({
    id: `hubspot_search_${key}`,
    title: `HubSpot: search ${label}`,
    description:
      `Search ${label} using HubSpot CRM filters and sorts. ` +
      "Filters in one group are ANDed; separate groups are ORed.",
    inputSchema: hubspotSearchSchema,
    outputSchema: hubspotListSchema,
    execute: async (input, { requestContext }) => {
      return hubspotRequest(`/crm/v3/objects/${key}/search`, {
        method: "POST",
        json: searchBody(input),
        authContext: { requestContext },
      });
    },
  });

  const getTool = createTool({
    id: `hubspot_get_${singular}`,
    title: `HubSpot: get ${singular}`,
    description: `Retrieve one ${singular} by record ID or a unique property.`,
    inputSchema: hubspotObjectGetSchema,
    outputSchema: hubspotObjectSchema,
    execute: async ({ objectId, ...input }, { requestContext }) => {
      return hubspotRequest(objectPath(key, objectId), {
        query: getQuery(input),
        authContext: { requestContext },
      });
    },
  });

  const createToolDef = createTool({
    id: `hubspot_create_${singular}`,
    title: `HubSpot: create ${singular}`,
    description:
      `Create a ${singular}. Pass property values keyed by internal property name ` +
      "and optional associations.",
    inputSchema: z.object({
      properties: hubspotPropertiesSchema,
      associations: z
        .array(hubspotAssociationInputSchema)
        .optional()
        .describe("Associations to create with the record"),
    }),
    outputSchema: hubspotObjectSchema,
    execute: async ({ properties, associations }, { requestContext }) => {
      if (Object.keys(properties).length === 0) {
        throw new Error("Provide at least one property.");
      }

      return hubspotRequest(objectPath(key), {
        method: "POST",
        json: {
          properties,
          ...(associations ? { associations } : {}),
        },
        authContext: { requestContext },
      });
    },
  });

  const updateTool = createTool({
    id: `hubspot_update_${singular}`,
    title: `HubSpot: update ${singular}`,
    description: `Update ${singular} properties by record ID. Omitted properties keep their values.`,
    inputSchema: z.object({
      objectId: z.string().min(1).describe("HubSpot record ID"),
      properties: hubspotPropertiesSchema,
      idProperty: z
        .string()
        .optional()
        .describe("Unique property to use instead of the record ID, e.g. email"),
    }),
    outputSchema: hubspotObjectSchema,
    execute: async ({ objectId, properties, idProperty }, { requestContext }) => {
      if (Object.keys(properties).length === 0) {
        throw new Error("Provide at least one property.");
      }

      return hubspotRequest(objectPath(key, objectId), {
        method: "PATCH",
        query: { idProperty },
        json: { properties },
        authContext: { requestContext },
      });
    },
  });

  const deleteTool = createTool({
    id: `hubspot_delete_${singular}`,
    title: `HubSpot: delete ${singular}`,
    description: `Archive a ${singular} by record ID. HubSpot keeps archived records recoverable.`,
    inputSchema: z.object({
      objectId: z.string().min(1).describe("HubSpot record ID"),
    }),
    outputSchema: z.object({
      archived: z.literal(true),
      id: z.string(),
    }),
    execute: async ({ objectId }, { requestContext }) => {
      await hubspotRequest(objectPath(key, objectId), {
        method: "DELETE",
        authContext: { requestContext },
      });

      return { archived: true as const, id: objectId };
    },
  });

  return {
    [`hubspotList${suffix}Tool`]: listTool,
    [`hubspotSearch${suffix}Tool`]: searchTool,
    [`hubspotGet${singularSuffix}Tool`]: getTool,
    [`hubspotCreate${singularSuffix}Tool`]: createToolDef,
    [`hubspotUpdate${singularSuffix}Tool`]: updateTool,
    [`hubspotDelete${singularSuffix}Tool`]: deleteTool,
  };
}

export const hubspotContactTools = createHubspotObjectTools({
  key: "contacts",
  singular: "contact",
  label: "contacts",
  description:
    "Contacts store people. Common properties: email, firstname, lastname, phone, lifecyclestage, hs_lead_status.",
});

export const hubspotCompanyTools = createHubspotObjectTools({
  key: "companies",
  singular: "company",
  label: "companies",
  description:
    "Companies store organizations. Common properties: name, domain, industry, city, country, phone.",
});

export const hubspotDealTools = createHubspotObjectTools({
  key: "deals",
  singular: "deal",
  label: "deals",
  description:
    "Deals track revenue opportunities. Common properties: dealname, amount, dealstage, pipeline, closedate.",
});

export const hubspotTicketTools = createHubspotObjectTools({
  key: "tickets",
  singular: "ticket",
  label: "tickets",
  description:
    "Tickets track support requests. Common properties: subject, content, hs_ticket_priority, hs_pipeline, hs_pipeline_stage.",
});

export const hubspotLeadTools = createHubspotObjectTools({
  key: "leads",
  singular: "lead",
  label: "leads",
  description:
    "Leads track potential customers. The private app must have the leads scope and a token that includes it.",
});

export const hubspotQuoteTools = createHubspotObjectTools({
  key: "quotes",
  singular: "quote",
  label: "quotes",
  description:
    "Quotes store sales quotes. Use properties such as hs_title, hs_status, hs_expiration_date, and hs_currency.",
});

export const hubspotOrderTools = createHubspotObjectTools({
  key: "orders",
  singular: "order",
  label: "orders",
  description:
    "Orders store commerce orders. Use properties such as hs_order_name, hs_order_status, and hs_total_price.",
});

export const hubspotInvoiceTools = createHubspotObjectTools({
  key: "invoices",
  singular: "invoice",
  label: "invoices",
  description:
    "Invoices store billing documents. Use properties such as hs_invoice_number, hs_invoice_status, and hs_total_amount.",
});

export const hubspotLineItemTools = createHubspotObjectTools({
  key: "line_items",
  singular: "line_item",
  label: "line items",
  suffix: "LineItems",
  singularSuffix: "LineItem",
  description:
    "Line items store products and quantities on deals, quotes, and orders. " +
    "Common properties: name, quantity, price, hs_product_id, hs_sku.",
});

export { createHubspotObjectTools };
