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
  recoverInterruptedWorkflows,
} from "./services/workflow-service.js";

/**
 * Recovers persisted workflow state, starts the Auto Mode scheduler, then serves the Fastify application.
 */
async function main() {
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
    },
  );

  scheduler.start();

  await app.listen({
    port:
      env.SERVER_PORT,
    host:
      "0.0.0.0",
  });

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
