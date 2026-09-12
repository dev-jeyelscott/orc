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
      getProjectAutomationStatuses:
        vi.fn(),
    }),
  );

vi.mock(
  "../services/auto-mode-service.js",
  () => mocks,
);

const {
  autoModeRoutes,
} = await import("./auto-mode.js");

let app:
  ReturnType<typeof Fastify>;

beforeEach(
  async () => {
    mocks.getProjectAutomationStatuses.mockReset();
    app = Fastify();
    await app.register(autoModeRoutes);
  },
);

afterEach(
  async () => {
    await app.close();
  },
);

describe(
  "GET /api/auto-mode/status",
  () => {
    it(
      "returns one server-derived entry per Project without configuration secrets",
      async () => {
        const statuses = [
          {
            projectPath:
              "/workspace/project-a",
            teamId:
              "00000000-0000-4000-9000-000000000001",
            autoModeEnabled:
              true,
            state:
              "ready",
            nextEligibleAt:
              null,
            blockedByActiveRun:
              false,
            unavailableReason:
              null,
          },
          {
            projectPath:
              "/workspace/project-b",
            teamId:
              "00000000-0000-4000-9000-000000000002",
            autoModeEnabled:
              true,
            state:
              "unavailable",
            nextEligibleAt:
              null,
            blockedByActiveRun:
              false,
            unavailableReason:
              "no_enabled_agents",
          },
        ];

        mocks.getProjectAutomationStatuses.mockResolvedValue(
          statuses,
        );

        const response =
          await app.inject({
            method:
              "GET",
            url:
              "/api/auto-mode/status",
          });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          projects: statuses,
        });
        expect(response.body).not.toContain("NOTION_API_KEY");
        expect(response.body).not.toContain("notionDataSourceId");
      },
    );
  },
);
