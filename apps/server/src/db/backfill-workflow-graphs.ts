import { queryClient } from "./client.js";
import { logger } from "../logger.js";
import { backfillAllTeams } from "../services/workflow-backfill-service.js";

/**
 * One-off migration entry point (run via `tsx --env-file=.env
 * src/db/backfill-workflow-graphs.ts`, matching `migrate.ts`'s convention)
 * that converts every Team's current layer/order/route workflow into an
 * equivalent Draft + Published v1 explicit-node graph. Run this against a
 * given environment's data before enabling the Slice 5 runtime cutover
 * there -- until every runnable Team has a Published graph, new Run
 * creation would otherwise be rejected outright.
 */
async function main() {
  logger.info("Backfilling Team workflow graphs...");

  const summary = await backfillAllTeams();

  logger.info(
    {
      converted: summary.converted.length,
      skipped: summary.skipped.length,
      aborted: summary.aborted.length,
    },
    "Backfill complete.",
  );

  if (summary.aborted.length) {
    for (const result of summary.aborted) {
      logger.warn({ teamId: result.teamId, errors: result.errors, reason: result.reason }, "Team could not be backfilled");
    }
  }

  await queryClient.end();

  if (summary.aborted.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, "Workflow graph backfill failed");
  process.exit(1);
});
