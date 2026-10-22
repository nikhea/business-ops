import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import { databaseUrl, readEnv } from "../config/env";
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { gmailTools } from "./tools/google/gmail-rest";
import { calendarTools } from "./tools/google/calendar-rest";
import { driveTools } from "./tools/google/drive-rest";
import { sheetsTools } from "./tools/google/sheets-rest";
import { docsTools } from "./tools/google/docs-rest";
import { meetTools } from "./tools/google/meet-rest";
import { airtableMetaTools } from "./tools/airtable/airtable-meta";
import { airtableRecordTools } from "./tools/airtable/airtable-records";
import { airtableCommentTools } from "./tools/airtable/airtable-comments";
import { airtableWebhookTools } from "./tools/airtable/airtable-webhooks";
import { clickupWorkspaceTools } from "./tools/clickup/clickup-workspace";
import { clickupTaskTools } from "./tools/clickup/clickup-tasks";
import { clickupCommentTools } from "./tools/clickup/clickup-comments";
import { clickupTimeTools } from "./tools/clickup/clickup-time";
import { clickupFieldTools } from "./tools/clickup/clickup-fields";
import { clickupWebhookTools } from "./tools/clickup/clickup-webhooks";
import { clickupChecklistTools } from "./tools/clickup/clickup-checklists";
import { notionUserTools } from "./tools/notion/notion-users";
import { notionSearchTools } from "./tools/notion/notion-search";
import { notionBlockTools } from "./tools/notion/notion-blocks";
import { notionPageTools } from "./tools/notion/notion-pages";
import { notionMarkdownTools } from "./tools/notion/notion-markdown";
import { notionDatabaseTools } from "./tools/notion/notion-databases";
import { notionDataSourceTools } from "./tools/notion/notion-data-sources";
import { notionCommentTools } from "./tools/notion/notion-comments";
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
} from "./tools/hubspot/hubspot-objects";
import { hubspotCustomObjectTools } from "./tools/hubspot/hubspot-custom-objects";
import { hubspotOwnerTools } from "./tools/hubspot/hubspot-owners";
import { hubspotPipelineTools } from "./tools/hubspot/hubspot-pipelines";
import { hubspotPropertyTools } from "./tools/hubspot/hubspot-properties";
import { hubspotAssociationTools } from "./tools/hubspot/hubspot-associations";
import { hubspotListTools } from "./tools/hubspot/hubspot-lists";
import { hubspotConversationTools } from "./tools/hubspot/hubspot-conversations";
import { hubspotFormTools } from "./tools/hubspot/hubspot-forms";
import { hubspotMarketingEventTools } from "./tools/hubspot/hubspot-marketing-events";
import { hubspotSchemaTools } from "./tools/hubspot/hubspot-schemas";
import { resendEmailTools } from "./tools/resend/resend-emails";
import { resendDomainTools } from "./tools/resend/resend-domains";
import { resendContactTools } from "./tools/resend/resend-contacts";
import { resendSegmentTools } from "./tools/resend/resend-segments";
import { resendBroadcastTools } from "./tools/resend/resend-broadcasts";
import { resendTemplateTools } from "./tools/resend/resend-templates";
import { resendWebhookTools } from "./tools/resend/resend-webhooks";
import { resendTopicTools } from "./tools/resend/resend-topics";
import { mastraAuth } from "../auth/mastra-auth";
import { sessionContext } from "../auth/session-context";

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent },
  tools: {
    ...gmailTools,
    ...calendarTools,
    ...driveTools,
    ...sheetsTools,
    ...docsTools,
    ...meetTools,
    ...airtableMetaTools,
    ...airtableRecordTools,
    ...airtableCommentTools,
    ...airtableWebhookTools,
    ...clickupWorkspaceTools,
    ...clickupTaskTools,
    ...clickupCommentTools,
    ...clickupTimeTools,
    ...clickupFieldTools,
    ...clickupWebhookTools,
    ...clickupChecklistTools,
    ...notionUserTools,
    ...notionSearchTools,
    ...notionBlockTools,
    ...notionPageTools,
    ...notionMarkdownTools,
    ...notionDatabaseTools,
    ...notionDataSourceTools,
    ...notionCommentTools,
    ...hubspotContactTools,
    ...hubspotCompanyTools,
    ...hubspotDealTools,
    ...hubspotTicketTools,
    ...hubspotLeadTools,
    ...hubspotQuoteTools,
    ...hubspotOrderTools,
    ...hubspotInvoiceTools,
    ...hubspotLineItemTools,
    ...hubspotCustomObjectTools,
    ...hubspotOwnerTools,
    ...hubspotPipelineTools,
    ...hubspotPropertyTools,
    ...hubspotAssociationTools,
    ...hubspotListTools,
    ...hubspotConversationTools,
    ...hubspotFormTools,
    ...hubspotMarketingEventTools,
    ...hubspotSchemaTools,
    ...resendEmailTools,
    ...resendDomainTools,
    ...resendContactTools,
    ...resendSegmentTools,
    ...resendBroadcastTools,
    ...resendTemplateTools,
    ...resendWebhookTools,
    ...resendTopicTools,
  },
  server: {
    port: 5000,
    host: "0.0.0.0",
    auth: mastraAuth,
    middleware: [{ path: "*", handler: sessionContext }],
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    },
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    // Memory, workflows, agents, and scores live in Postgres.
    default: new PostgresStore({
      id: "pg-storage",
      connectionString: databaseUrl(),
    }),
    // Traces, logs, metrics, and feedback go to an embedded analytical store.
    domains: {
      observability: new DuckDBStore({
        id: "duckdb-observability",
        path: readEnv("MASTRA_DUCKDB_PATH") ?? "mastra.duckdb",
      }).observability,
    },
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
        logging: {
          enabled: true,
          level: "info", // default is 'warn', so info-level logs are dropped unless raised
        },
      },
    },
  }),
});
