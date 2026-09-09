import assert from "node:assert/strict";

import {
  cancelRun,
  getTeamAutomationStatuses,
  skipRun,
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

/**
 * Ensures bodyless workflow controls do not advertise an empty JSON payload that Fastify will reject before routing.
 */
async function testBodylessRunControlsDoNotSendEmptyJsonBody(): Promise<void> {
  let requestInit: RequestInit | undefined;
  let requestUrl = "";

  globalThis.fetch = async (
    input,
    init,
  ) => {
    requestInit = init;
    requestUrl = input.toString();

    return new Response(
      JSON.stringify({
        id: "00000000-0000-4000-9000-000000000010",
        teamId: "00000000-0000-4000-9000-000000000001",
        projectPath: "/workspace/orc",
        taskId: null,
        status: "cancelled",
        currentAgentId: null,
        executionCount: 1,
        terminalReason: "Cancelled by operator",
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:01.000Z",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  try {
    await cancelRun(
      "00000000-0000-4000-9000-000000000010",
    );

    assert.equal(
      new Headers(
        requestInit?.headers,
      ).has(
        "content-type",
      ),
      false,
    );

    await skipRun(
      "00000000-0000-4000-9000-000000000010",
    );

    assert.equal(
      requestUrl.endsWith("/skip"),
      true,
    );

    assert.equal(
      new Headers(
        requestInit?.headers,
      ).has(
        "content-type",
      ),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void testTeamAutomationStatusClient()
  .then(
    testBodylessRunControlsDoNotSendEmptyJsonBody,
  )
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
