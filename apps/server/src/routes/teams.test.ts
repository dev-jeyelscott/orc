import Fastify from "fastify";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(
    () => ({
      createTeam:
        vi.fn(),
      deleteTeam:
        vi.fn(),
      getTeam:
        vi.fn(),
      listTeams:
        vi.fn(),
      updateTeam:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/team-service.js",
  () => ({
    TeamServiceError:
      class TeamServiceError
        extends Error {
        constructor(
          message: string,
          readonly statusCode: number,
        ) {
          super(message);
        }
      },
    ...mocks,
  }),
);

const {
  TeamServiceError,
} =
  await import(
    "../services/team-service.js"
  );

const {
  teamRoutes,
} =
  await import(
    "./teams.js"
  );

const TEAM_ID =
  "00000000-0000-4000-9000-000000000099";

const team = {
  id:
    TEAM_ID,
  slug:
    "platform",
  name:
    "Platform Team",
  description:
    "",
  enabled:
    true,
  notionDataSourceId:
    "notion-platform-source",
  autoModeEnabled:
    true,
  createdAt:
    "2026-09-09T00:00:00.000Z",
  updatedAt:
    "2026-09-09T00:00:00.000Z",
};

let app:
  ReturnType<
    typeof Fastify
  >;

beforeEach(
  async () => {
    for (
      const mock of
      Object.values(
        mocks,
      )
    ) {
      mock.mockReset();
    }

    app =
      Fastify();

    await app.register(
      teamRoutes,
    );
  },
);

afterEach(
  async () => {
    await app.close();
  },
);

describe(
  "Team routes",
  () => {
    it(
      "ignores legacy automation fields through Team creation",
      async () => {
        mocks.createTeam.mockResolvedValue(
          team,
        );

        const response =
          await app.inject({
            method:
              "POST",
            url:
              "/api/teams",
            payload: {
              slug:
                team.slug,
              name:
                team.name,
              description:
                team.description,
              enabled:
                team.enabled,
              notionDataSourceId:
                team.notionDataSourceId,
              autoModeEnabled:
                team.autoModeEnabled,
            },
          });

        expect(
          response.statusCode,
        ).toBe(201);

        expect(
          mocks.createTeam,
        ).toHaveBeenCalledWith({
          slug:
            team.slug,
          name:
            team.name,
          description:
            team.description,
          enabled:
            team.enabled,
        });

        expect(
          response.json(),
        ).toEqual(team);
      },
    );

    it(
      "returns stable Team service validation and data-source conflicts",
      async () => {
        mocks.updateTeam.mockRejectedValueOnce(
          new TeamServiceError(
            "A Notion data source ID is required when Auto Mode is enabled",
            400,
          ),
        );

        const invalidResponse =
          await app.inject({
            method:
              "PATCH",
            url:
              `/api/teams/${TEAM_ID}`,
            payload: {
              autoModeEnabled:
                true,
            },
          });

        expect(
          invalidResponse.statusCode,
        ).toBe(400);
        expect(
          invalidResponse.json(),
        ).toEqual({
          error:
            "A Notion data source ID is required when Auto Mode is enabled",
        });

        mocks.updateTeam.mockRejectedValueOnce(
          new TeamServiceError(
            "That Notion data source is already assigned to another Team",
            409,
          ),
        );

        const conflictResponse =
          await app.inject({
            method:
              "PATCH",
            url:
              `/api/teams/${TEAM_ID}`,
            payload: {
              notionDataSourceId:
                "notion-platform-source",
            },
          });

        expect(
          conflictResponse.statusCode,
        ).toBe(409);
        expect(
          conflictResponse.json(),
        ).toEqual({
          error:
            "That Notion data source is already assigned to another Team",
        });
      },
    );

    it(
      "serializes Team configuration without API-key data",
      async () => {
        mocks.listTeams.mockResolvedValue([
          team,
        ]);

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/teams",
          });

        expect(
          response.statusCode,
        ).toBe(200);
        expect(
          response.json(),
        ).toEqual({
          teams: [team],
        });
        expect(
          response.body,
        ).not.toContain(
          "NOTION_API_KEY",
        );
      },
    );
  },
);
