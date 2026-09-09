import {
  describe,
  expect,
  it,
} from "vitest";

import {
  teamAutomationStatusResponseSchema,
  teamAutomationStatusSchema,
} from "./system-settings.js";

describe(
  "system settings contracts",
  () => {
    it.each([
      "off",
      "ready",
      "running",
      "waiting_approval",
      "cooldown",
      "unavailable",
    ] as const)(
      "accepts Team automation state %s",
      (state) => {
        expect(
          teamAutomationStatusSchema.parse({
            teamId:
              "00000000-0000-4000-9000-000000009999",
            autoModeEnabled:
              state !== "off",
            state,
            nextEligibleAt:
              null,
            blockedByActiveRun:
              true,
            unavailableReason:
              state === "unavailable"
                ? "missing_notion_data_source"
                : null,
          }).state,
        ).toBe(state);
      },
    );

    it(
      "accepts aggregate Team automation status without secrets",
      () => {
        expect(
          teamAutomationStatusResponseSchema.parse({
            teams: [
              {
                teamId:
                  "00000000-0000-4000-9000-000000009999",
                autoModeEnabled:
                  true,
                state:
                  "cooldown",
                nextEligibleAt:
                  "2026-09-04T14:30:00.000Z",
                blockedByActiveRun:
                  false,
                unavailableReason:
                  null,
              },
            ],
          }),
        ).toEqual({
          teams: [
            {
              teamId:
                "00000000-0000-4000-9000-000000009999",
              autoModeEnabled:
                true,
              state:
                "cooldown",
              nextEligibleAt:
                "2026-09-04T14:30:00.000Z",
              blockedByActiveRun:
                false,
              unavailableReason:
                null,
            },
          ],
        });
      },
    );

    it.each([
      "team_disabled",
      "missing_notion_data_source",
      "missing_notion_api_key",
      "no_enabled_agents",
    ] as const)(
      "accepts unavailable reason %s",
      (unavailableReason) => {
        expect(
          teamAutomationStatusSchema.parse({
            teamId:
              "00000000-0000-4000-9000-000000009999",
            autoModeEnabled:
              true,
            state:
              "unavailable",
            nextEligibleAt:
              null,
            blockedByActiveRun:
              false,
            unavailableReason,
          }).unavailableReason,
        ).toBe(unavailableReason);
      },
    );
  },
);
