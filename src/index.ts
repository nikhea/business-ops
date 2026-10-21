import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { mastra } from "./mastra/index";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
const server = new MastraServer({ app, mastra, openapiPath: "/openapi.json" });
await server.init();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// MastraServer serves the spec at <prefix><openapiPath>, and prefix defaults to /api
const openapiUrl = "/api/openapi.json";

app.use("/swagger-ui/*", swaggerUI({ url: openapiUrl }));

serve({ fetch: app.fetch, port: 5000 }, () => {
  console.log("Server running on port 5000");
  console.log(`OpenAPI spec: http://localhost:5000${openapiUrl}`);
  console.log("Swagger UI:   http://localhost:5000/swagger-ui");
});
