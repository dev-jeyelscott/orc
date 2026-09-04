import {
  describe,
  expect,
  it,
} from "vitest";

import {
  systemSettingsResponseSchema,
  systemSettingsSchema,
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
