import {
  describe,
  expect,
  it,
} from "vitest";

import {
  runSchema,
} from "./run.js";

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

const RUN_ID =
  "00000000-0000-4000-8000-000000000010";

/**
 * Creates one valid persisted Run payload for Team-scope contract tests.
 */
function runPayload() {
  return {
    id:
      RUN_ID,
    teamId:
      TEAM_ID,
    projectPath:
      "/workspace/orc",
    taskId:
      null,
    status:
      "running" as const,
    currentAgentId:
      null,
    executionCount:
      0,
    terminalReason:
      null,
    createdAt:
      "2026-09-05T00:00:00.000Z",
    updatedAt:
      "2026-09-05T00:00:00.000Z",
  };
}

describe(
  "run contracts",
  () => {
    it(
      "requires persisted Runs to expose Team ownership",
      () => {
        expect(
          runSchema.parse(
            runPayload(),
          ).teamId,
        ).toBe(
          TEAM_ID,
        );
      },
    );

    it(
      "rejects a persisted Run without Team ownership",
      () => {
        const {
          teamId:
            _teamId,
          ...withoutTeam
        } =
          runPayload();

        expect(
          runSchema.safeParse(
            withoutTeam,
          ).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
