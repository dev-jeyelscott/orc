import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createTeamSchema,
  teamSchema,
  updateTeamSchema,
} from "./team.js";

const TEST_TEAM_ID =
  "00000000-0000-4000-9000-000000009999";

describe(
  "Team DTO contracts",
  () => {
    it(
      "accepts a valid Team create payload",
      () => {
        expect(
          createTeamSchema.parse({
            slug:
              "platform-engineering",
            name:
              "Platform Engineering",
          }),
        ).toEqual({
          slug:
            "platform-engineering",
          name:
            "Platform Engineering",
          description:
            "",
          enabled:
            true,
        });
      },
    );

    it(
      "rejects a non-kebab-case Team slug",
      () => {
        expect(
          createTeamSchema.safeParse({
            slug:
              "Platform Engineering",
            name:
              "Platform Engineering",
          }).success,
        ).toBe(false);
      },
    );

    it(
      "keeps Team updates partial",
      () => {
        expect(
          updateTeamSchema.parse({
            enabled:
              false,
          }),
        ).toEqual({
          enabled:
            false,
        });
      },
    );

    it(
      "validates persisted Team responses",
      () => {
        const timestamp =
          new Date(
            "2026-09-05T00:00:00.000Z",
          ).toISOString();

        expect(
          teamSchema.parse({
            id:
              TEST_TEAM_ID,
            slug:
              "development",
            name:
              "Development Team",
            description:
              "",
            enabled:
              true,
            createdAt:
              timestamp,
            updatedAt:
              timestamp,
          }).slug,
        ).toBe(
          "development",
        );
      },
    );
  },
);
