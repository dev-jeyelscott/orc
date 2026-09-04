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
      listEvents:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/event-service.js",
  () => ({
    listEvents:
      mocks.listEvents,
  }),
);

const {
  buildApp,
} =
  await import(
    "../app.js"
  );

let app:
  Awaited<
    ReturnType<
      typeof buildApp
    >
  >;

/**
 * Creates one valid empty event-history response for route tests.
 */
function eventPage(
  page = 1,
  pageSize = 50,
) {
  return {
    events: [],
    page,
    pageSize,
    hasMore: false,
  };
}

beforeEach(
  async () => {
    mocks.listEvents.mockReset();

    app =
      await buildApp();
  },
);

afterEach(
  async () => {
    await app.close();
  },
);

describe(
  "event routes",
  () => {
    it(
      "uses the bounded default event-history page",
      async () => {
        mocks.listEvents.mockResolvedValue(
          eventPage(),
        );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/events",
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          response.headers[
            "cache-control"
          ],
        ).toBe(
          "no-store",
        );

        expect(
          mocks.listEvents,
        ).toHaveBeenCalledWith({
          page: 1,
          pageSize: 50,
        });

        expect(
          response.json(),
        ).toEqual(
          eventPage(),
        );
      },
    );

    it(
      "passes validated explicit pagination to the service",
      async () => {
        mocks.listEvents.mockResolvedValue(
          eventPage(
            2,
            25,
          ),
        );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/events?page=2&pageSize=25",
          });

        expect(
          response.statusCode,
        ).toBe(
          200,
        );

        expect(
          mocks.listEvents,
        ).toHaveBeenCalledWith({
          page: 2,
          pageSize: 25,
        });
      },
    );

    it(
      "rejects invalid page numbers",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/events?page=0",
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.listEvents,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects event pages above the maximum page size",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/events?pageSize=101",
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.listEvents,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects nonnumeric pagination",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/events?page=abc",
          });

        expect(
          response.statusCode,
        ).toBe(
          400,
        );

        expect(
          mocks.listEvents,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
