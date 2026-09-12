import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(
    () => {
      const query:
        Record<
          string,
          unknown
        > = {};

      const from =
        vi.fn(
          () =>
            query,
        );

      const innerJoin =
        vi.fn(
          () =>
            query,
        );

      const where =
        vi.fn(
          () =>
            query,
        );

      const limit =
        vi.fn();

      const select =
        vi.fn(
          () =>
            query,
        );

      Object.assign(
        query,
        {
          from,
          innerJoin,
          where,
          limit,
        },
      );

      return {
        select,
        from,
        innerJoin,
        where,
        limit,
        getTeam:
          vi.fn(),
        getProjectTeamAssignmentByPath:
          vi.fn(),
        getProjectByPath:
          vi.fn(),
        env: {
          NOTION_API_KEY:
            undefined as
              | string
              | undefined,
          WORKSPACE_ROOT:
            "/tmp/orc-workspace",
        },
      };
    },
  );

vi.mock(
  "../config/env.js",
  () => ({
    env:
      mocks.env,
  }),
);

vi.mock(
  "../db/client.js",
  () => ({
    db: {
      select:
        mocks.select,
    },
  }),
);

vi.mock(
  "./notion-task-source.js",
  () => ({
    createNotionTaskSourceAdapter:
      vi.fn(),
  }),
);

vi.mock(
  "./workflow-service.js",
  () => ({
    startTask:
      vi.fn(),
  }),
);

vi.mock(
  "./team-service.js",
  () => ({
    getTeam:
      mocks.getTeam,
    listTeams:
      vi.fn(),
  }),
);

vi.mock(
  "./project-team-assignment-service.js",
  () => ({
    getProjectTeamAssignmentByPath:
      mocks.getProjectTeamAssignmentByPath,
    listProjectTeamAssignments:
      vi.fn(),
  }),
);

vi.mock(
  "./project-discovery.js",
  () => ({
    getProjectByPath:
      mocks.getProjectByPath,
  }),
);

import {
  getProjectAutomationReadiness,
} from "./auto-mode-service.js";

const TEAM_ID =
  "33333333-3333-4333-8333-333333333333";

const PROJECT_PATH =
  "/tmp/orc-workspace/project-readiness";

/**
 * Builds a fully-configured Project Team assignment, overridden per test case.
 */
function buildAssignment(
  overrides:
    Partial<{
      teamId:
        string;
      notionDataSourceId:
        string | null;
      autoModeEnabled:
        boolean;
    }> = {},
) {
  return {
    projectPath:
      PROJECT_PATH,
    teamId:
      TEAM_ID,
    teamName:
      "Development",
    notionDataSourceId:
      "data-source-id",
    autoModeEnabled:
      true,
    createdAt:
      "2026-01-01T00:00:00.000Z",
    updatedAt:
      "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Builds a Team row, overridden per test case.
 */
function buildTeam(
  overrides:
    Partial<{
      enabled:
        boolean;
    }> = {},
) {
  return {
    id:
      TEAM_ID,
    slug:
      "development",
    name:
      "Development",
    description:
      "",
    enabled:
      true,
    ...overrides,
  };
}

/**
 * Clears observations while preserving the fluent mock implementations.
 */
function resetMocks(): void {
  mocks.select.mockClear();
  mocks.from.mockClear();
  mocks.innerJoin.mockClear();
  mocks.where.mockClear();
  mocks.limit.mockReset();
  mocks.getTeam.mockReset();
  mocks.getProjectTeamAssignmentByPath.mockReset();
  mocks.getProjectByPath.mockReset();
  mocks.env.NOTION_API_KEY =
    "notion-secret";

  mocks.getProjectByPath
    .mockResolvedValue({
      id:
        "orc-project-readiness",
      name:
        "project-readiness",
      path:
        PROJECT_PATH,
      branch:
        "main",
      gitState:
        "clean",
      primaryFiles: [],
      packageManager:
        "pnpm",
      stack:
        "node",
    });
}

beforeEach(
  () => {
    resetMocks();
  },
);

describe(
  "Project automation readiness",
  () => {
    it(
      "reports team_disabled when no Project assignment exists",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            null,
          );

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result,
        ).toEqual({
          projectPath:
            PROJECT_PATH,
          teamId:
            null,
          notionDataSourceId:
            null,
          autoModeEnabled:
            false,
          ready:
            false,
          unavailableReason:
            "team_disabled",
        });
      },
    );

    it(
      "reports team_disabled when the assigned Team is disabled",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment(),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam({
              enabled:
                false,
            }),
          );

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result.ready,
        ).toBe(
          false,
        );

        expect(
          result.unavailableReason,
        ).toBe(
          "team_disabled",
        );
      },
    );

    it(
      "reports missing_notion_data_source when the assignment has no configured data source",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment({
              notionDataSourceId:
                null,
            }),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result.ready,
        ).toBe(
          false,
        );

        expect(
          result.unavailableReason,
        ).toBe(
          "missing_notion_data_source",
        );
      },
    );

    it(
      "reports missing_notion_api_key when the shared Notion API key is not configured",
      async () => {
        mocks.env.NOTION_API_KEY =
          undefined;

        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment(),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result.ready,
        ).toBe(
          false,
        );

        expect(
          result.unavailableReason,
        ).toBe(
          "missing_notion_api_key",
        );
      },
    );

    it(
      "reports no_enabled_agents when the Team has no enabled worker Agent",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment(),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        mocks.limit
          .mockResolvedValueOnce([]);

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result.ready,
        ).toBe(
          false,
        );

        expect(
          result.unavailableReason,
        ).toBe(
          "no_enabled_agents",
        );
      },
    );

    it(
      "reports ready when the Project assignment is fully configured",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment(),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        mocks.limit
          .mockResolvedValueOnce([
            {
              id:
                "team-member-1",
            },
          ]);

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result,
        ).toEqual({
          projectPath:
            PROJECT_PATH,
          teamId:
            TEAM_ID,
          notionDataSourceId:
            "data-source-id",
          autoModeEnabled:
            true,
          ready:
            true,
          unavailableReason:
            null,
        });
      },
    );

    it(
      "reports not-ready but no unavailable reason when a configured Project simply has Auto Mode switched off",
      async () => {
        mocks.getProjectTeamAssignmentByPath
          .mockResolvedValue(
            buildAssignment({
              autoModeEnabled:
                false,
            }),
          );

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        mocks.limit
          .mockResolvedValueOnce([
            {
              id:
                "team-member-1",
            },
          ]);

        const result =
          await getProjectAutomationReadiness(
            PROJECT_PATH,
          );

        expect(
          result,
        ).toEqual({
          projectPath:
            PROJECT_PATH,
          teamId:
            TEAM_ID,
          notionDataSourceId:
            "data-source-id",
          autoModeEnabled:
            false,
          ready:
            false,
          unavailableReason:
            null,
        });
      },
    );
  },
);
