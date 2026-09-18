import type { ConfigurationStatusResponse } from "@orc/shared";

import { env } from "../config/env.js";
import { getConfigOutOfSyncState } from "../config/health-state.js";
import { loadConfigGraph } from "../config/loader.js";

const MAX_REPORTED_ERRORS = 50;

export interface ConfigurationReadiness {
  ready: boolean;
  reason: string | null;
}

/**
 * Roadmap Vertical Spec 7 readiness gate: invalid or out-of-sync
 * configuration must block new manual Run starts and Auto Mode claims
 * without taking down the API/dashboard or existing history (section 16.1).
 */
export async function getConfigurationReadiness(): Promise<ConfigurationReadiness> {
  const status = await getConfigurationStatus();

  if (status.state === "invalid") {
    return { ready: false, reason: "Configuration is invalid. Fix .orc/ and retry before starting new work." };
  }

  if (status.state === "out_of_sync") {
    return { ready: false, reason: "Configuration is out of sync with its canonical files. Run an explicit sync before starting new work." };
  }

  return { ready: true, reason: null };
}

/**
 * Loads and validates the current `.orc/` tree and reports read-only
 * configuration health. An invalid file graph always wins over in-memory
 * out-of-sync state: a broken tree is never reported as merely stale.
 */
export async function getConfigurationStatus(): Promise<ConfigurationStatusResponse> {
  const graph = await loadConfigGraph(env.ORC_CONFIG_ROOT);
  const outOfSync = getConfigOutOfSyncState();

  return {
    state: !graph.valid ? "invalid" : outOfSync ? "out_of_sync" : "valid",
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
