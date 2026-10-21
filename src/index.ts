import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { mastra } from "./mastra/index";
import { googleOAuthRoutes } from "./routes/google";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
const server = new MastraServer({ app, mastra, openapiPath: "/openapi.json" });
await server.init();

app.route("/google", googleOAuthRoutes);

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// MastraServer serves the spec at <prefix><openapiPath>, and prefix defaults to /api
const openapiUrl = "/api/openapi.json";

app.use("/swagger-ui/*", swaggerUI({ url: openapiUrl }));

const port = Number(process.env.PORT || 5000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
  console.log(`OpenAPI spec: http://localhost:${port}${openapiUrl}`);
  console.log(`Swagger UI:   http://localhost:${port}/swagger-ui`);
});
