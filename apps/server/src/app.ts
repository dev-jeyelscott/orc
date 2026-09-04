import cors from "@fastify/cors";
import Fastify from "fastify";

import { loggerOptions } from "./logger.js";
import { agentExecutionRoutes } from "./routes/agent-executions.js";
import { agentMonitoringRoutes } from "./routes/agent-monitoring.js";
import { agentRoutes } from "./routes/agents.js";
import { conversationRoutes } from "./routes/conversations.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { workflowRoutes } from "./routes/workflows.js";
import { registerWebSocket } from "./ws/index.js";

/**
 * Constructs and registers the complete Fastify application.
 */
export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
  });

  await app.register(cors, {
    origin: true,
  });

  await registerWebSocket(app);

  await app.register(
    healthRoutes,
  );

  await app.register(
    projectRoutes,
  );

  await app.register(
    agentMonitoringRoutes,
  );

  await app.register(
    agentRoutes,
  );

  await app.register(
    agentExecutionRoutes,
  );

  await app.register(
    workflowRoutes,
  );

  await app.register(
    conversationRoutes,
  );

  await app.register(
    eventRoutes,
  );

  await app.register(
    dashboardRoutes,
  );

  return app;
}
