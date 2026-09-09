import {
  describe,
  expect,
  it,
} from "vitest";

import {
  automationStatusResponseSchema,
  automationStatusSchema,
  systemSettingsResponseSchema,
  systemSettingsSchema,
  teamAutomationStatusResponseSchema,
  teamAutomationStatusSchema,
  updateSystemSettingsSchema,
} from "./system-settings.js";

describe(
  "system settings contracts",
  () => {
    it(
      "accepts the global Auto Mode setting",
      () => {
        expect(
          systemSettingsSchema.parse({
            autoModeEnabled:
              true,
          }),
        ).toEqual({
          autoModeEnabled:
            true,
        });
      },
    );

    it(
      "accepts a persisted Auto Mode update",
      () => {
        expect(
          updateSystemSettingsSchema.parse({
            autoModeEnabled:
              false,
          }),
        ).toEqual({
          autoModeEnabled:
            false,
        });
      },
    );

    it(
      "accepts the settings response shape",
      () => {
        expect(
          systemSettingsResponseSchema.parse({
            settings: {
              autoModeEnabled:
                false,
            },
          }),
        ).toEqual({
          settings: {
            autoModeEnabled:
              false,
          },
        });
      },
    );

    it.each([
      "off",
      "running",
      "waiting_approval",
      "ready",
    ] as const)(
      "accepts automation state %s without a cooldown timestamp",
      (state) => {
        expect(
          automationStatusSchema.parse({
            state,
            nextEligibleAt:
              null,
          }),
        ).toEqual({
          state,
          nextEligibleAt:
            null,
        });
      },
    );

    it(
      "accepts cooldown status with the next eligible timestamp",
      () => {
        const nextEligibleAt =
          "2026-09-04T14:30:00.000Z";

        expect(
          automationStatusResponseSchema.parse({
            status: {
              state:
                "cooldown",
              nextEligibleAt,
            },
          }),
        ).toEqual({
          status: {
            state:
              "cooldown",
            nextEligibleAt,
          },
        });
      },
    );

    it(
      "rejects non-boolean Auto Mode state",
      () => {
        expect(
          systemSettingsSchema.safeParse({
            autoModeEnabled:
              "on",
          }).success,
        ).toBe(
          false,
        );
      },
    );

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
