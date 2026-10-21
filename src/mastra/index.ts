import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
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
  },
  server: {
    port: 5000,
    host: "0.0.0.0",
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    },
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      // Uses a hosted database when deployed (mastra env db create --kind turso),
      // and a local file during development.
      url: process.env.TURSO_DATABASE_URL ?? "file:./mastra.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
    domains: {
      observability: await new DuckDBStore().getStore("observability"),
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
