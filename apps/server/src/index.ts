import {
  buildApp,
} from "./app.js";

import {
  env,
} from "./config/env.js";

import {
  logger,
} from "./logger.js";

import {
  createAutoModeScheduler,
} from "./services/auto-mode-scheduler.js";

import {
  registerAutoModeCycleRequester,
} from "./services/auto-mode-signal.js";

import {
  closeKnowledgeMcpClient,
} from "./services/knowledge-mcp-client.js";

import {
  synchronizeConfiguration,
} from "./services/config-sync-service.js";

import {
  recoverInterruptedWorkflows,
} from "./services/workflow-service.js";

/**
 * Synchronizes `.orc/` configuration, recovers persisted workflow state,
 * binds the server, then starts Auto Mode intake and polling. Roadmap
 * Vertical Spec 7, section 16.1: an invalid `.orc/` tree must never crash
 * startup -- the API/dashboard and existing history stay available, new
 * manual Run starts and Auto Mode claims are gated separately by
 * `getConfigurationReadiness()`.
 */
async function main() {
  try {
    const syncResult = await synchronizeConfiguration();
    if (syncResult.status === "invalid") {
      logger.warn(
        { errorCount: syncResult.errorCount },
        "Starting in degraded configuration mode: .orc/ is invalid. New Runs and Auto Mode are blocked until fixed and synced.",
      );
    }
  } catch (error) {
    logger.error({ error }, "Startup configuration sync failed; starting in degraded configuration mode");
  }

  await recoverInterruptedWorkflows();

  const app =
    await buildApp();

  const scheduler =
    createAutoModeScheduler();

  const unregisterCycleRequester =
    registerAutoModeCycleRequester(
      () => {
        scheduler.requestCycle();
      },
    );

  app.addHook(
    "onClose",
    async () => {
      unregisterCycleRequester();
      scheduler.stop();

      await closeKnowledgeMcpClient();
    },
  );

  await app.listen({
    port:
      env.SERVER_PORT,
    host:
      "0.0.0.0",
  });

  scheduler.start();

  logger.info(
    `Server listening on port ${env.SERVER_PORT}`,
  );

  logger.info(
    `Workspace root: ${env.WORKSPACE_ROOT}`,
  );
}

main().catch(
  (error) => {
    logger.error(
      {
        error,
      },
      "Failed to start server",
    );

    process.exit(1);
  },
);
