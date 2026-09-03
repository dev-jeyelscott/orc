import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@orc/shared";

import { getHealthStatus } from "../services/health-service.js";

/**
 * Registers the existing application health endpoint.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (): Promise<HealthResponse> => {
    return getHealthStatus((error) => {
      app.log.warn({ error }, "Health check DB ping failed");
    });
  });
}
