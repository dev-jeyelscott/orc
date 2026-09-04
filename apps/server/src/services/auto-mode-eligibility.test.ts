import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveAutoModeEligibility,
} from "./auto-mode-service.js";

const now =
  new Date(
    "2026-09-04T14:00:00.000Z",
  );

/**
 * Creates a completed approved eligibility snapshot at the supplied completion time.
 */
function approvedSnapshot(
  completedAt:
    Date,
) {
  return {
    runStatus:
      "completed" as const,
    latestExecution: {
      resultStatus:
        "approved" as const,
      completedAt,
    },
  };
}

describe(
  "Auto Mode eligibility",
  () => {
    it(
      "allows intake when no prior task-associated run exists",
      () => {
        expect(
          resolveAutoModeEligibility(
            null,
            now,
            5,
          ),
        ).toEqual({
          eligible:
            true,
          state:
            "ready",
          nextEligibleAt:
            null,
        });
      },
    );

    it.each([
      "pending",
      "running",
    ] as const)(
      "blocks intake while the latest run is %s",
      (runStatus) => {
        expect(
          resolveAutoModeEligibility(
            {
              runStatus,
              latestExecution:
                null,
            },
            now,
            5,
          ),
        ).toMatchObject({
          eligible:
            false,
          state:
            "running",
        });
      },
    );

    it.each([
      "failed",
      "blocked",
      "cancelled",
    ] as const)(
      "does not unlock intake when the latest run is %s",
      (runStatus) => {
        expect(
          resolveAutoModeEligibility(
            {
              runStatus,
              latestExecution:
                null,
            },
            now,
            5,
          ),
        ).toMatchObject({
          eligible:
            false,
          state:
            "waiting_approval",
        });
      },
    );

    it.each([
      "completed",
      "changes_requested",
      "blocked",
      "failed",
      null,
    ] as const)(
      "does not unlock a completed run whose latest result status is %s",
      (resultStatus) => {
        expect(
          resolveAutoModeEligibility(
            {
              runStatus:
                "completed",
              latestExecution: {
                resultStatus,
                completedAt:
                  new Date(
                    "2026-09-04T13:59:00.000Z",
                  ),
              },
            },
            now,
            5,
          ),
        ).toMatchObject({
          eligible:
            false,
          state:
            "waiting_approval",
        });
      },
    );

    it(
      "requires an approved execution to have completedAt",
      () => {
        expect(
          resolveAutoModeEligibility(
            {
              runStatus:
                "completed",
              latestExecution: {
                resultStatus:
                  "approved",
                completedAt:
                  null,
              },
            },
            now,
            5,
          ),
        ).toMatchObject({
          eligible:
            false,
          state:
            "waiting_approval",
        });
      },
    );

    it(
      "returns cooldown until the configured post-approval delay elapses",
      () => {
        const result =
          resolveAutoModeEligibility(
            approvedSnapshot(
              new Date(
                "2026-09-04T13:59:58.000Z",
              ),
            ),
            now,
            5,
          );

        expect(
          result,
        ).toEqual({
          eligible:
            false,
          state:
            "cooldown",
          nextEligibleAt:
            new Date(
              "2026-09-04T14:00:03.000Z",
            ),
        });
      },
    );

    it(
      "allows intake after the post-approval delay has elapsed",
      () => {
        expect(
          resolveAutoModeEligibility(
            approvedSnapshot(
              new Date(
                "2026-09-04T13:59:50.000Z",
              ),
            ),
            now,
            5,
          ),
        ).toEqual({
          eligible:
            true,
          state:
            "ready",
          nextEligibleAt:
            null,
        });
      },
    );
  },
);
