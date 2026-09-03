import type {
  FastifyInstance,
} from "fastify";
import { z } from "zod";

import {
  agentMonitoringRangeSchema,
} from "@orc/shared";

import {
  getAgentObservability,
  listAgentMonitoringOverview,
} from "../services/agent-monitoring-service.js";

const querySchema =
  z.object({
    range:
      agentMonitoringRangeSchema
        .default("7d"),
  });

const agentParamsSchema =
  z.object({
    agentId:
      z.string().uuid(),
  });

/**
 * Registers additive read-only endpoints used by the Agents operator dashboard.
 */
export async function agentMonitoringRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/api/agents/monitoring",
    async (
      request,
      reply,
    ) => {
      const parsed =
        querySchema.safeParse(
          request.query,
        );

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues
                .map(
                  (issue) =>
                    issue.message,
                )
                .join(", "),
          });
      }

      return listAgentMonitoringOverview(
        parsed.data.range,
      );
    },
  );

  app.get(
    "/api/agents/:agentId/observability",
    async (
      request,
      reply,
    ) => {
      const params =
        agentParamsSchema.safeParse(
          request.params,
        );

      const query =
        querySchema.safeParse(
          request.query,
        );

      if (
        !params.success ||
        !query.success
      ) {
        return reply
          .status(400)
          .send({
            error:
              "Invalid agent monitoring request",
          });
      }

      const result =
        await getAgentObservability(
          params.data.agentId,
          query.data.range,
        );

      return (
        result ??
        reply
          .status(404)
          .send({
            error:
              "agent_not_found",
          })
      );
    },
  );
}
