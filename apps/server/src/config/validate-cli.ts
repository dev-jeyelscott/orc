import { env } from "../config/env.js";
import { loadConfigGraph } from "./loader.js";

/**
 * `pnpm config:validate` -- dry-run validation only. Never mutates
 * PostgreSQL and never changes runtime authority; it only reports whether
 * `ORC_CONFIG_ROOT` currently parses and cross-validates cleanly.
 */
async function main() {
  const graph = await loadConfigGraph(env.ORC_CONFIG_ROOT);

  console.log(`Configuration root: ${graph.configRoot}`);

  if (graph.valid) {
    console.log(
      `Valid. ${graph.departments.length} department(s), ${graph.agents.length} agent(s), ${graph.skills.length} skill(s), ${graph.teams.length} team(s), ${graph.projects.length} project(s).`,
    );
    return;
  }

  console.log(`Invalid. ${graph.issues.length} issue(s) found:\n`);

  for (const issue of graph.issues) {
    console.log(
      `- [${issue.resourceType}${issue.resourceId ? `:${issue.resourceId}` : ""}] ${issue.filePath}${issue.field ? ` (${issue.field})` : ""}: ${issue.message}`,
    );
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Configuration validation failed to run:", error);
  process.exitCode = 1;
});
