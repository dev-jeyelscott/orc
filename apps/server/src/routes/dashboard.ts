import type { FastifyInstance } from "fastify";
import { dashboardSummarySchema } from "@orc/shared";

import { getDashboardSummary } from "../services/dashboard-service.js";

/**
 * Registers the bounded read-only dashboard summary endpoint.
 */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async (_request, reply) => {
    reply.header("cache-control", "no-store");

    return dashboardSummarySchema.parse(
      await getDashboardSummary(),
    );
  });
}
