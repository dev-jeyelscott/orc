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
          new Date().toISOString();

        expect(
          teamSchema.parse({
            id:
              crypto.randomUUID(),
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
