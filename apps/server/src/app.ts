import Fastify from "fastify";
import cors from "@fastify/cors";

import { loggerOptions } from "./logger.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { agentRoutes } from "./routes/agents.js";
import { registerWebSocket } from "./ws/index.js";

export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  await app.register(cors, { origin: true });
  await registerWebSocket(app);
  await app.register(healthRoutes);
  await app.register(projectRoutes);
  await app.register(agentRoutes);

  return app;
}
