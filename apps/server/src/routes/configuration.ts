import type { FastifyInstance } from "fastify";
import type { ConfigurationStatusResponse } from "@orc/shared";

import { synchronizeConfiguration } from "../services/config-sync-service.js";
import { getConfigurationStatus } from "../services/configuration-status-service.js";

/**
 * Registers the Git-backed configuration status/sync endpoints. Sync is
 * server-owned and idempotent (roadmap Vertical Spec 7): it re-reads and
 * re-validates the current `.orc/` graph and never partially applies a
 * broken tree.
 */
export async function configurationRoutes(app: FastifyInstance) {
  app.get("/api/configuration/status", async (): Promise<ConfigurationStatusResponse> => {
    return getConfigurationStatus();
  });

  app.post("/api/configuration/sync", async (_request, reply) => {
    const result = await synchronizeConfiguration();

    if (result.status === "invalid") {
      return reply.status(409).send({ error: "configuration_invalid", errorCount: result.errorCount });
    }

    return result;
  });
}
