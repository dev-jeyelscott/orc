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
          where,
          limit,
        },
      );

      return {
        select,
        from,
        where,
        limit,
        getTeam:
          vi.fn(),
        env: {
          NOTION_API_KEY:
            undefined as
              | string
              | undefined,
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
  }),
);

import {
  getTeamAutomationReadiness,
} from "./auto-mode-service.js";

const TEAM_ID =
  "33333333-3333-4333-8333-333333333333";

/**
 * Builds a fully-configured Team row, overridden per test case.
 */
function buildTeam(
  overrides:
    Partial<{
      enabled:
        boolean;
      notionDataSourceId:
        string | null;
      autoModeEnabled:
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
    notionDataSourceId:
      "data-source-id",
    autoModeEnabled:
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
  mocks.where.mockClear();
  mocks.limit.mockReset();
  mocks.getTeam.mockReset();
  mocks.env.NOTION_API_KEY =
    "notion-secret";
}

beforeEach(
  () => {
    resetMocks();
  },
);

describe(
  "Team automation readiness",
  () => {
    it(
      "reports team_disabled for a nonexistent Team",
      async () => {
        mocks.getTeam
          .mockResolvedValue(
            null,
          );

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
          );

        expect(
          result,
        ).toEqual({
          team:
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
      "reports team_disabled when the Team itself is disabled",
      async () => {
        mocks.getTeam
          .mockResolvedValue(
            buildTeam({
              enabled:
                false,
            }),
          );

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
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
      "reports missing_notion_data_source when the Team has no configured data source",
      async () => {
        mocks.getTeam
          .mockResolvedValue(
            buildTeam({
              notionDataSourceId:
                null,
            }),
          );

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
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

        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
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
        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        mocks.limit
          .mockResolvedValueOnce([]);

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
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
      "reports ready when the Team is fully configured",
      async () => {
        mocks.getTeam
          .mockResolvedValue(
            buildTeam(),
          );

        mocks.limit
          .mockResolvedValueOnce([
            {
              id:
                "agent-1",
            },
          ]);

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
          );

        expect(
          result,
        ).toEqual({
          team:
            buildTeam(),
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
      "reports not-ready but no unavailable reason when a configured Team simply has Auto Mode switched off",
      async () => {
        mocks.getTeam
          .mockResolvedValue(
            buildTeam({
              autoModeEnabled:
                false,
            }),
          );

        mocks.limit
          .mockResolvedValueOnce([
            {
              id:
                "agent-1",
            },
          ]);

        const result =
          await getTeamAutomationReadiness(
            TEAM_ID,
          );

        expect(
          result,
        ).toEqual({
          team:
            buildTeam({
              autoModeEnabled:
                false,
            }),
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
