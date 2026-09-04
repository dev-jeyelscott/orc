import type {
  FastifyInstance,
} from "fastify";

import {
  updateSystemSettingsSchema,
} from "@orc/shared";

import {
  getAutomationStatus,
  getSystemSettings,
  updateSystemSettings,
} from "../services/auto-mode-service.js";
import {
  requestAutoModeCycle,
} from "../services/auto-mode-signal.js";

/**
 * Registers persisted Auto Mode settings and derived operator-status endpoints.
 */
export async function autoModeRoutes(
  app:
    FastifyInstance,
) {
  app.get(
    "/api/auto-mode",
    async () => ({
      settings:
        await getSystemSettings(),
    }),
  );

  app.patch(
    "/api/auto-mode",
    async (
      request,
      reply,
    ) => {
      const parsed =
        updateSystemSettingsSchema.safeParse(
          request.body,
        );

      if (
        !parsed.success
      ) {
        return reply
          .status(400)
          .send({
            error:
              parsed.error.issues
                .map(
                  (issue) =>
                    issue.message,
                )
                .join(
                  ", ",
                ),
          });
      }

      const settings =
        await updateSystemSettings(
          parsed.data,
        );

      if (
        settings.autoModeEnabled
      ) {
        requestAutoModeCycle();
      }

      return {
        settings,
      };
    },
  );

  app.get(
    "/api/auto-mode/status",
    async () => ({
      status:
        await getAutomationStatus(),
    }),
  );
}
