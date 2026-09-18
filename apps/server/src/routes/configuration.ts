import type { FastifyInstance } from "fastify";
import type { ConfigurationStatusResponse } from "@orc/shared";

import { getConfigurationStatus } from "../services/configuration-status-service.js";

/**
 * Registers the read-only Git-backed configuration status endpoint. This
 * slice never mutates a PostgreSQL projection here -- no sync endpoint
 * exists yet.
 */
export async function configurationRoutes(app: FastifyInstance) {
  app.get("/api/configuration/status", async (): Promise<ConfigurationStatusResponse> => {
    return getConfigurationStatus();
  });
}
