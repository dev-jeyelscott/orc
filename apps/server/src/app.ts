import Fastify from "fastify";
import cors from "@fastify/cors";

import { loggerOptions } from "./logger.js";
import { healthRoutes } from "./routes/health.js";
import { registerWebSocket } from "./ws/index.js";

export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  await app.register(cors, { origin: true });
  await registerWebSocket(app);
  await app.register(healthRoutes);

  return app;
}
