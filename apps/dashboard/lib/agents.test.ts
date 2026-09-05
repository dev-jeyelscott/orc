import assert from "node:assert/strict";

import type {
  CreateAgent,
} from "@orc/shared";

import {
  scopeCreateAgentToTeam,
} from "./agents";

const SOURCE_TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

const TARGET_TEAM_ID =
  "00000000-0000-4000-9000-000000000002";

/**
 * Verifies Team-owned Agent creation always replaces an arbitrary draft Team with the selected Team.
 */
function testCreateAgentTeamScope(): void {
  const input:
    CreateAgent = {
      teamId:
        SOURCE_TEAM_ID,
      slug:
        "test-worker",
      name:
        "Test Worker",
      role:
        "Generic Role",
      description: "",
      layer: 1,
      executionOrder: 1,
      harness:
        "codex",
      model:
        "default",
      reasoning:
        "medium",
      systemPrompt:
        "Perform the requested work.",
      enabled: true,
      canWrite: false,
      canRunCommands: true,
      canCommit: false,
    };

  const scoped =
    scopeCreateAgentToTeam(
      input,
      TARGET_TEAM_ID,
    );

  assert.equal(
    scoped.teamId,
    TARGET_TEAM_ID,
  );

  assert.equal(
    scoped.slug,
    input.slug,
  );

  assert.equal(
    input.teamId,
    SOURCE_TEAM_ID,
  );
}

testCreateAgentTeamScope();

console.log(
  "agent client helper tests passed",
);
