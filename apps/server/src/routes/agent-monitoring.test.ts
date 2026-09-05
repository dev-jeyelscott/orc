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
      listAgentMonitoringOverview:
        vi.fn(),
      getAgentObservability:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/agent-monitoring-service.js",
  () => ({
    listAgentMonitoringOverview:
      mocks.listAgentMonitoringOverview,
    getAgentObservability:
      mocks.getAgentObservability,
  }),
);

const {
  buildApp,
} =
  await import(
    "../app.js"
  );

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

let app:
  Awaited<
    ReturnType<
      typeof buildApp
    >
  >;

/**
 * Creates a valid empty Agent overview response for route tests.
 */
function emptyOverview() {
  return {
    range:
      "7d" as const,
    agents: [],
    metrics: {
      totalAgents: 0,
      enabledAgents: 0,
      layers: 0,
      activeExecutions: 0,
      activeRuns: 0,
      enabledRouteRules: 0,
      approvedResults: 0,
      changesRequestedResults:
        0,
    },
    validationIssues: [],
    recentEvents: [],
  };
}

beforeEach(
  async () => {
    mocks
      .listAgentMonitoringOverview
      .mockReset();

    mocks
      .getAgentObservability
      .mockReset();

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
  "agent monitoring routes",
  () => {
    it(
      "passes a validated Team scope into the overview service",
      async () => {
        mocks
          .listAgentMonitoringOverview
          .mockResolvedValue(
            emptyOverview(),
          );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              `/api/agents/monitoring?range=7d&teamId=${TEAM_ID}`,
          });

        expect(
          response.statusCode,
        ).toBe(200);

        expect(
          mocks
            .listAgentMonitoringOverview,
        ).toHaveBeenCalledWith(
          "7d",
          TEAM_ID,
        );
      },
    );

    it(
      "preserves the existing unscoped overview contract for compatibility",
      async () => {
        mocks
          .listAgentMonitoringOverview
          .mockResolvedValue(
            emptyOverview(),
          );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/agents/monitoring?range=7d",
          });

        expect(
          response.statusCode,
        ).toBe(200);

        expect(
          mocks
            .listAgentMonitoringOverview,
        ).toHaveBeenCalledWith(
          "7d",
          undefined,
        );
      },
    );

    it(
      "rejects an invalid Team identifier before calling the monitoring service",
      async () => {
        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/agents/monitoring?teamId=not-a-uuid",
          });

        expect(
          response.statusCode,
        ).toBe(400);

        expect(
          mocks
            .listAgentMonitoringOverview,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
