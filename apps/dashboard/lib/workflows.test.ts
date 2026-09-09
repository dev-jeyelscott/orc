import assert from "node:assert/strict";

import {
  getTeamAutomationStatuses,
} from "./workflows";

const originalFetch = globalThis.fetch;

/**
 * Verifies the Tasks client validates the Team-scoped server response instead of accepting an obsolete singleton.
 */
async function testTeamAutomationStatusClient(): Promise<void> {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        teams: [
          {
            teamId:
              "00000000-0000-4000-9000-000000000001",
            autoModeEnabled:
              true,
            state:
              "ready",
            nextEligibleAt:
              null,
            blockedByActiveRun:
              false,
            unavailableReason:
              null,
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type":
            "application/json",
        },
      },
    );

  try {
    assert.deepEqual(
      await getTeamAutomationStatuses(),
      [
        {
          teamId:
            "00000000-0000-4000-9000-000000000001",
          autoModeEnabled:
            true,
          state:
            "ready",
          nextEligibleAt:
            null,
          blockedByActiveRun:
            false,
          unavailableReason:
            null,
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void testTeamAutomationStatusClient()
  .then(
    () => {
      console.log(
        "workflow client helper tests passed",
      );
    },
  )
  .catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
