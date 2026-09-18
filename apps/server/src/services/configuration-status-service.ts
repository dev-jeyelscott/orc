import type { ConfigurationStatusResponse } from "@orc/shared";

import { env } from "../config/env.js";
import { loadConfigGraph } from "../config/loader.js";

const MAX_REPORTED_ERRORS = 50;

/**
 * Loads and validates the current `.orc/` tree and reports read-only
 * configuration health. This slice never synchronizes a PostgreSQL
 * projection, so status is only ever `valid` or `invalid`.
 */
export async function getConfigurationStatus(): Promise<ConfigurationStatusResponse> {
  const graph = await loadConfigGraph(env.ORC_CONFIG_ROOT);

  return {
    state: graph.valid ? "valid" : "invalid",
    configRoot: graph.configRoot,
    departmentCount: graph.departments.length,
    agentCount: graph.agents.length,
    skillCount: graph.skills.length,
    teamCount: graph.teams.length,
    projectCount: graph.projects.length,
    errorCount: graph.issues.length,
    errors: graph.issues.slice(0, MAX_REPORTED_ERRORS),
  };
}
