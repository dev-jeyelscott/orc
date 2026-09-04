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
          where,
          orderBy,
          limit,
        },
      );

      return {
        select,
        from,
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

import {
  evaluateAutoModeEligibility,
} from "./auto-mode-service.js";

/**
 * Clears query observations while preserving the fluent mock implementations.
 */
function resetQueryMocks(): void {
  mocks.select.mockClear();
  mocks.from.mockClear();
  mocks.where.mockClear();
  mocks.orderBy.mockClear();
  mocks.limit.mockReset();
}

beforeEach(
  () => {
    resetQueryMocks();
  },
);

describe(
  "Auto Mode persistence gate",
  () => {
    it(
      "short-circuits historical approval state when PostgreSQL contains an active run",
      async () => {
        mocks.limit
          .mockResolvedValueOnce([
            {
              status:
                "running",
            },
          ]);

        const result =
          await evaluateAutoModeEligibility(
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
          await evaluateAutoModeEligibility(
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
        });

        expect(
          mocks.select,
        ).toHaveBeenCalledTimes(
          4,
        );
      },
    );
  },
);
