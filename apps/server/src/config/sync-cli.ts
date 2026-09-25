import { env } from "./env.js";
import { queryClient } from "../db/client.js";
import { synchronizeConfiguration } from "../services/config-sync-service.js";

/**
 * `pnpm config:sync` -- explicit synchronization (roadmap Vertical Spec 7,
 * section 16.3). Loads and fully validates `ORC_CONFIG_ROOT`, refuses to
 * run against a broken tree, and otherwise projects every resource into
 * its PostgreSQL table in dependency order.
 */
async function main() {
  try {
    const result = await synchronizeConfiguration(env.ORC_CONFIG_ROOT);

    if (result.status === "invalid") {
      console.log(`Configuration is invalid (${result.errorCount} issue(s)). Sync refused; run "pnpm config:validate" for details.`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `Synced. ${result.departmentCount} department(s), ${result.agentCount} agent(s), ${result.skillCount} skill(s), ${result.teamCount} team(s), ${result.projectCount} project(s).`,
    );
  } finally {
    // Close the pool so the CLI exits instead of idling on open connections.
    await queryClient.end();
  }
}

main().catch((error) => {
  console.error("Configuration sync failed to run:", error);
  process.exitCode = 1;
});
