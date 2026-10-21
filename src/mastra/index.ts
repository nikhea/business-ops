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

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent },
  tools: {
    ...gmailTools,
    ...calendarTools,
    ...driveTools,
    ...sheetsTools,
    ...docsTools,
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
