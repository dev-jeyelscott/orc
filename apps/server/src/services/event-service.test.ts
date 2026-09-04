import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(
    () => ({
      rows:
        [] as Array<{
          id: string;
          type: string;
          projectPath: string;
          taskId: string | null;
          runId: string | null;
          agentExecutionId:
            string | null;
          data:
            Record<
              string,
              unknown
            >;
          createdAt: Date;
        }>,
      select:
        vi.fn(),
      from:
        vi.fn(),
      orderBy:
        vi.fn(),
      limit:
        vi.fn(),
      offset:
        vi.fn(),
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

const {
  listEvents,
} =
  await import(
    "./event-service.js"
  );

/**
 * Creates one deterministic persisted event row for pagination tests.
 */
function makeRow(
  index: number,
) {
  return {
    id:
      crypto.randomUUID(),
    type:
      `event.${index}`,
    projectPath:
      "/workspace/orc",
    taskId:
      null,
    runId:
      null,
    agentExecutionId:
      null,
    data: {
      index,
    },
    createdAt:
      new Date(
        Date.UTC(
          2099,
          0,
          1,
          0,
          index,
          0,
        ),
      ),
  };
}

/**
 * Configures the mocked Drizzle select chain with deterministic newest-first behavior.
 */
function configureQueryMock() {
  mocks.select.mockReturnValue({
    from:
      mocks.from,
  });

  mocks.from.mockReturnValue({
    orderBy:
      mocks.orderBy,
  });

  mocks.orderBy.mockReturnValue({
    limit:
      mocks.limit,
  });

  mocks.limit.mockImplementation(
    (
      limit: number,
    ) => ({
      offset:
        (
          offset: number,
        ) => {
          mocks.offset(
            offset,
          );

          const ordered =
            [
              ...mocks.rows,
            ].sort(
              (
                left,
                right,
              ) =>
                right.createdAt.getTime() -
                left.createdAt.getTime(),
            );

          return Promise.resolve(
            ordered.slice(
              offset,
              offset +
                limit,
            ),
          );
        },
    }),
  );
}

beforeEach(
  () => {
    mocks.rows.length =
      0;

    for (
      const mock of [
        mocks.select,
        mocks.from,
        mocks.orderBy,
        mocks.limit,
        mocks.offset,
      ]
    ) {
      mock.mockReset();
    }

    configureQueryMock();
  },
);

describe(
  "event-service history",
  () => {
    it(
      "returns the default bounded page newest first",
      async () => {
        mocks.rows.push(
          makeRow(1),
          makeRow(3),
          makeRow(2),
        );

        const result =
          await listEvents();

        expect(
          result,
        ).toMatchObject({
          page: 1,
          pageSize: 50,
          hasMore: false,
        });

        expect(
          result.events.map(
            (event) =>
              event.type,
          ),
        ).toEqual([
          "event.3",
          "event.2",
          "event.1",
        ]);

        expect(
          mocks.limit,
        ).toHaveBeenCalledWith(
          51,
        );

        expect(
          mocks.offset,
        ).toHaveBeenCalledWith(
          0,
        );
      },
    );

    it(
      "uses one extra row to report hasMore",
      async () => {
        mocks.rows.push(
          makeRow(1),
          makeRow(2),
          makeRow(3),
        );

        const result =
          await listEvents({
            page: 1,
            pageSize: 2,
          });

        expect(
          result.events,
        ).toHaveLength(
          2,
        );

        expect(
          result.hasMore,
        ).toBe(
          true,
        );

        expect(
          mocks.limit,
        ).toHaveBeenCalledWith(
          3,
        );
      },
    );

    it(
      "applies page offsets without overlapping the previous page",
      async () => {
        mocks.rows.push(
          makeRow(4),
          makeRow(1),
          makeRow(3),
          makeRow(2),
        );

        const result =
          await listEvents({
            page: 2,
            pageSize: 2,
          });

        expect(
          result.events.map(
            (event) =>
              event.type,
          ),
        ).toEqual([
          "event.2",
          "event.1",
        ]);

        expect(
          result.hasMore,
        ).toBe(
          false,
        );

        expect(
          mocks.offset,
        ).toHaveBeenCalledWith(
          2,
        );
      },
    );

    it(
      "returns an empty terminal page",
      async () => {
        const result =
          await listEvents({
            page: 1,
            pageSize: 10,
          });

        expect(
          result.events,
        ).toEqual(
          [],
        );

        expect(
          result.hasMore,
        ).toBe(
          false,
        );
      },
    );

    it(
      "accepts the maximum page size and rejects larger requests",
      async () => {
        mocks.rows.push(
          ...Array.from(
            {
              length:
                101,
            },
            (
              _value,
              index,
            ) =>
              makeRow(
                index + 1,
              ),
          ),
        );

        const result =
          await listEvents({
            pageSize: 100,
          });

        expect(
          result.events,
        ).toHaveLength(
          100,
        );

        expect(
          result.hasMore,
        ).toBe(
          true,
        );

        expect(
          mocks.limit,
        ).toHaveBeenCalledWith(
          101,
        );

        await expect(
          listEvents({
            pageSize: 101,
          }),
        ).rejects.toThrow();
      },
    );
  },
);
