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

      const orderBy =
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
          orderBy,
          limit,
        },
      );

      return {
        select,
        from,
        innerJoin,
        where,
        orderBy,
        limit,
      };
    },
  );

vi.mock(
  "../config/env.js",
  () => ({
    env: {
      NOTION_POST_APPROVAL_DELAY_SECONDS:
        5,
    },
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
      vi.fn(),
    listTeams:
      vi.fn(),
  }),
);

vi.mock(
  "./project-team-assignment-service.js",
  () => ({
    getProjectTeamAssignmentByPath:
      vi.fn(),
    listProjectTeamAssignments:
      vi.fn(),
  }),
);

vi.mock(
  "./project-discovery.js",
  () => ({
    getProjectByPath:
      vi.fn(),
  }),
);

import {
  evaluateProjectAutoModeEligibility,
} from "./auto-mode-service.js";

/**
 * Clears query observations while preserving the fluent mock implementations.
 */
function resetQueryMocks(): void {
  mocks.select.mockClear();
  mocks.from.mockClear();
  mocks.innerJoin.mockClear();
  mocks.where.mockClear();
  mocks.orderBy.mockClear();
  mocks.limit.mockReset();
}

const RESOLUTION_TEAM_ID =
  "11111111-1111-4111-8111-111111111111";

const DEVELOPMENT_TEAM_ID =
  "22222222-2222-4222-8222-222222222222";

const PROJECT_PATH =
  "/tmp/orc-persistence-gate";

beforeEach(
  () => {
    resetQueryMocks();
  },
);

describe(
  "Auto Mode persistence gate",
  () => {
    it(
      "short-circuits historical approval state when PostgreSQL contains an active run for this Project's Team",
      async () => {
        mocks.limit
          .mockResolvedValueOnce([
            {
              status:
                "running",
              teamId:
                RESOLUTION_TEAM_ID,
            },
          ]);

        const result =
          await evaluateProjectAutoModeEligibility(
            PROJECT_PATH,
            RESOLUTION_TEAM_ID,
            new Date(
              "2026-09-04T14:00:00.000Z",
            ),
          );

        expect(
          result,
        ).toEqual({
          eligible:
            false,
          state:
            "running",
          nextEligibleAt:
            null,
          blockedByActiveRun:
            true,
        });

        expect(
          mocks.select,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "reads historical task, latest run, and latest execution only after confirming there is no active run",
      async () => {
        mocks.limit
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              taskId:
                "task-1",
            },
          ])
          .mockResolvedValueOnce([
            {
              id:
                "run-1",
              status:
                "completed",
            },
          ])
          .mockResolvedValueOnce([
            {
              resultStatus:
                "approved",
              completedAt:
                new Date(
                  "2026-09-04T13:59:50.000Z",
                ),
            },
          ]);

        const result =
          await evaluateProjectAutoModeEligibility(
            PROJECT_PATH,
            RESOLUTION_TEAM_ID,
            new Date(
              "2026-09-04T14:00:00.000Z",
            ),
          );

        expect(
          result,
        ).toEqual({
          eligible:
            true,
          state:
            "ready",
          nextEligibleAt:
            null,
          blockedByActiveRun:
            false,
        });

        expect(
          mocks.select,
        ).toHaveBeenCalledTimes(
          4,
        );
      },
    );

    it(
      "reports blockedByActiveRun without collapsing another Team's active run into this Project's own state",
      async () => {
        mocks.limit
          .mockResolvedValueOnce([
            {
              status:
                "running",
              teamId:
                DEVELOPMENT_TEAM_ID,
            },
          ]);

        const result =
          await evaluateProjectAutoModeEligibility(
            PROJECT_PATH,
            RESOLUTION_TEAM_ID,
            new Date(
              "2026-09-04T14:00:00.000Z",
            ),
          );

        expect(
          result,
        ).toEqual({
          eligible:
            false,
          state:
            "ready",
          nextEligibleAt:
            null,
          blockedByActiveRun:
            true,
        });

        expect(
          mocks.select,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
