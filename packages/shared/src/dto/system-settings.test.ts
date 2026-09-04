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
  },
);
