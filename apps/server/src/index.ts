import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { recoverInterruptedWorkflows } from "./services/workflow-service.js";

async function main() {
  await recoverInterruptedWorkflows();
  const app = await buildApp();

  await app.listen({ port: env.SERVER_PORT, host: "0.0.0.0" });
  logger.info(`Server listening on port ${env.SERVER_PORT}`);
  logger.info(`Workspace root: ${env.WORKSPACE_ROOT}`);
}

main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
