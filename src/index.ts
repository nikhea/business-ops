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

// Add Swagger UI — point it at the OpenAPI spec path
app.use("/swagger-ui/*", swaggerUI({ url: "/openapi.json" }));

serve({ fetch: app.fetch, port: 5000 }, () => {
  console.log("Server running on port 5000");
  console.log("OpenAPI spec: http://localhost:5000/openapi.json");
  console.log("Swagger UI:   http://localhost:5000/swagger-ui");
});
