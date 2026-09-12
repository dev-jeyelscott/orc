import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTeamWorkflow: vi.fn(),
  replaceTeamWorkflow: vi.fn(),
}));

vi.mock("../services/team-workflow-service.js", () => ({
  TeamWorkflowServiceError: class TeamWorkflowServiceError extends Error {
    constructor(message: string, readonly statusCode: number) {
      super(message);
    }
  },
  ...mocks,
}));

const { TeamWorkflowServiceError } = await import(
  "../services/team-workflow-service.js"
);
const { teamWorkflowRoutes } = await import("./team-workflow.js");

const TEAM_ID = "00000000-0000-4000-9000-000000000098";
const AGENT_ID = "00000000-0000-4000-8000-000000000099";

const workflow = {
  teamId: TEAM_ID,
  members: [
    {
      id: "00000000-0000-4000-7000-000000000001",
      teamId: TEAM_ID,
      departmentId: "00000000-0000-4000-6000-000000000001",
      agentId: AGENT_ID,
      agent: {} as unknown,
      layer: 1,
      executionOrder: 1,
      routes: [],
    },
  ],
};

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  app = Fastify();
  await app.register(teamWorkflowRoutes);
});

afterEach(async () => {
  await app.close();
});

describe("Team workflow routes", () => {
  it("returns the persisted workflow for GET", async () => {
    mocks.getTeamWorkflow.mockResolvedValue(workflow);

    const response = await app.inject({
      method: "GET",
      url: `/api/teams/${TEAM_ID}/workflow`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(workflow);
  });

  it("returns 404 when the Team does not exist", async () => {
    mocks.getTeamWorkflow.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: `/api/teams/${TEAM_ID}/workflow`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("replaces the workflow atomically through PUT", async () => {
    mocks.replaceTeamWorkflow.mockResolvedValue(workflow);

    const payload = {
      members: [
        {
          agentId: AGENT_ID,
          layer: 1,
          executionOrder: 1,
          routes: [
            {
              outcome: "blocked",
              targetAgentId: null,
              terminalAction: "block_run",
            },
            {
              outcome: "changes_requested",
              targetAgentId: null,
              terminalAction: "block_run",
            },
            {
              outcome: "failed",
              targetAgentId: null,
              terminalAction: "fail_run",
            },
          ],
        },
      ],
    };

    const response = await app.inject({
      method: "PUT",
      url: `/api/teams/${TEAM_ID}/workflow`,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.replaceTeamWorkflow).toHaveBeenCalledWith(
      TEAM_ID,
      expect.objectContaining({
        members: expect.arrayContaining([
          expect.objectContaining({ agentId: AGENT_ID }),
        ]),
      }),
    );
  });

  it("converts a service error into a stable API response", async () => {
    mocks.replaceTeamWorkflow.mockRejectedValue(
      new TeamWorkflowServiceError("A route target must be a selected member of the same Team", 400),
    );

    const response = await app.inject({
      method: "PUT",
      url: `/api/teams/${TEAM_ID}/workflow`,
      payload: { members: [] },
    });

    expect(response.statusCode).toBe(400);
  });
});
