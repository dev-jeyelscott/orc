import {
  eq,
  or,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  agentRoutes,
  agents,
  runs,
  teams,
} from "../db/schema.js";
import {
  createAgentRoute,
  deleteAgent,
  updateAgent,
  updateAgentRoute,
} from "./agent-service.js";

const createdAgentIds =
  new Set<string>();

const createdRunIds =
  new Set<string>();

const createdTeamIds =
  new Set<string>();

let nextLayer =
  100_000 +
  Math.floor(
    Math.random() *
      100_000_000,
  );

/**
 * Creates and tracks one disposable Team.
 */
async function createTestTeam(
  label: string,
) {
  const [team] =
    await db
      .insert(teams)
      .values({
        slug:
          `agent-test-${label}-${crypto.randomUUID()}`,
        name:
          `Agent Test ${label}`,
      })
      .returning();

  createdTeamIds.add(
    team.id,
  );

  return team;
}

/**
 * Creates a uniquely configured test agent and tracks it for cleanup.
 */
async function createTestAgent(
  label: string,
  options: {
    enabled?: boolean;
    teamId?: string;
    layer?: number;
    executionOrder?: number;
  } = {},
) {
  const [agent] =
    await db
      .insert(agents)
      .values({
        teamId:
          options.teamId ??
          RESOLUTION_TEAM_ID,
        slug:
          `test-${label.toLowerCase()}-${crypto.randomUUID()}`,
        name:
          `Test ${label}`,
        role:
          label,
        description:
          `${label} test agent`,
        layer:
          options.layer ??
          nextLayer++,
        executionOrder:
          options.executionOrder ??
          1,
        harness:
          "codex",
        model:
          "default",
        reasoning:
          "high",
        systemPrompt:
          `Act as the ${label} test agent.`,
        enabled:
          options.enabled ??
          true,
        canWrite:
          false,
        canRunCommands:
          true,
        canCommit:
          false,
      })
      .returning();

  createdAgentIds.add(
    agent.id,
  );

  return agent;
}

/**
 * Creates a tracked run with the supplied workflow snapshot and status.
 */
async function createTestRun(
  workflowSnapshot:
    unknown,
  status:
    | "pending"
    | "running"
    | "completed" =
    "completed",
) {
  const [run] =
    await db
      .insert(runs)
      .values({
        projectPath:
          "/tmp/orc-agent-service-test",
        status,
        workflowSnapshot,
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  return run;
}

describe(
  "agent-service",
  () => {
    afterEach(
      async () => {
        for (
          const runId of
          createdRunIds
        ) {
          await db
            .delete(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.runId,
                runId,
              ),
            );

          await db
            .delete(runs)
            .where(
              eq(
                runs.id,
                runId,
              ),
            );
        }

        for (
          const agentId of
          createdAgentIds
        ) {
          await db
            .delete(
              agentRoutes,
            )
            .where(
              or(
                eq(
                  agentRoutes.sourceAgentId,
                  agentId,
                ),
                eq(
                  agentRoutes.targetAgentId,
                  agentId,
                ),
              ),
            );
        }

        for (
          const agentId of
          createdAgentIds
        ) {
          await db
            .delete(agents)
            .where(
              eq(
                agents.id,
                agentId,
              ),
            );
        }

        for (
          const teamId of
          createdTeamIds
        ) {
          await db
            .delete(teams)
            .where(
              eq(
                teams.id,
                teamId,
              ),
            );
        }

        createdRunIds.clear();
        createdAgentIds.clear();
        createdTeamIds.clear();
      },
    );

    it(
      "keeps route enabled state independent from source agent enabled state",
      async () => {
        const source =
          await createTestAgent(
            "Source",
          );

        const target =
          await createTestAgent(
            "Target",
          );

        const route =
          await createAgentRoute(
            source.id,
            {
              outcome:
                "changes_requested",
              targetAgentId:
                target.id,
              terminalAction:
                null,
              enabled:
                true,
            },
          );

        await updateAgent(
          source.id,
          {
            enabled:
              false,
          },
        );

        const [persisted] =
          await db
            .select()
            .from(
              agentRoutes,
            )
            .where(
              eq(
                agentRoutes.id,
                route.id,
              ),
            );

        expect(
          persisted.enabled,
        ).toBe(true);

        expect(
          persisted.sourceAgentId,
        ).toBe(
          source.id,
        );

        expect(
          persisted.targetAgentId,
        ).toBe(
          target.id,
        );
      },
    );

    it(
      "rejects disabling a target agent while an enabled incoming route remains",
      async () => {
        const source =
          await createTestAgent(
            "Disable Source",
          );

        const target =
          await createTestAgent(
            "Disable Target",
          );

        await createAgentRoute(
          source.id,
          {
            outcome:
              "changes_requested",
            targetAgentId:
              target.id,
            terminalAction:
              null,
            enabled:
              true,
          },
        );

        await expect(
          updateAgent(
            target.id,
            {
              enabled:
                false,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });
      },
    );

    it(
      "allows a disabled route to retain a disabled same-Team target",
      async () => {
        const source =
          await createTestAgent(
            "Disabled Route Source",
          );

        const target =
          await createTestAgent(
            "Disabled Route Target",
            {
              enabled:
                false,
            },
          );

        const route =
          await createAgentRoute(
            source.id,
            {
              outcome:
                "changes_requested",
              targetAgentId:
                target.id,
              terminalAction:
                null,
              enabled:
                false,
            },
          );

        expect(
          route.enabled,
        ).toBe(false);

        await expect(
          updateAgentRoute(
            source.id,
            route.id,
            {
              enabled:
                true,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
        });
      },
    );

    it(
      "rejects a route targeting another Team",
      async () => {
        const firstTeam =
          await createTestTeam(
            "first",
          );

        const secondTeam =
          await createTestTeam(
            "second",
          );

        const source =
          await createTestAgent(
            "Cross Source",
            {
              teamId:
                firstTeam.id,
            },
          );

        const target =
          await createTestAgent(
            "Cross Target",
            {
              teamId:
                secondTeam.id,
            },
          );

        await expect(
          createAgentRoute(
            source.id,
            {
              outcome:
                "changes_requested",
              targetAgentId:
                target.id,
              terminalAction:
                null,
              enabled:
                true,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
          message:
            expect.stringContaining(
              "another Team",
            ),
        });
      },
    );

    it(
      "rejects a Team move when an outgoing route would become cross-Team",
      async () => {
        const sourceTeam =
          await createTestTeam(
            "move-source",
          );

        const destinationTeam =
          await createTestTeam(
            "move-destination",
          );

        const source =
          await createTestAgent(
            "Moving Source",
            {
              teamId:
                sourceTeam.id,
            },
          );

        const target =
          await createTestAgent(
            "Moving Target",
            {
              teamId:
                sourceTeam.id,
            },
          );

        await createAgentRoute(
          source.id,
          {
            outcome:
              "changes_requested",
            targetAgentId:
              target.id,
            terminalAction:
              null,
            enabled:
              true,
          },
        );

        await expect(
          updateAgent(
            source.id,
            {
              teamId:
                destinationTeam.id,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "cross-Team",
            ),
        });
      },
    );

    it(
      "rejects a Team move when an incoming route would become cross-Team",
      async () => {
        const sourceTeam =
          await createTestTeam(
            "incoming-source",
          );

        const destinationTeam =
          await createTestTeam(
            "incoming-destination",
          );

        const source =
          await createTestAgent(
            "Incoming Source",
            {
              teamId:
                sourceTeam.id,
            },
          );

        const target =
          await createTestAgent(
            "Incoming Target",
            {
              teamId:
                sourceTeam.id,
            },
          );

        await createAgentRoute(
          source.id,
          {
            outcome:
              "changes_requested",
            targetAgentId:
              target.id,
            terminalAction:
              null,
            enabled:
              true,
          },
        );

        await expect(
          updateAgent(
            target.id,
            {
              teamId:
                destinationTeam.id,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "cross-Team",
            ),
        });
      },
    );

    it(
      "rejects a Team move when the destination slot is occupied",
      async () => {
        const sourceTeam =
          await createTestTeam(
            "slot-source",
          );

        const destinationTeam =
          await createTestTeam(
            "slot-destination",
          );

        const layer =
          nextLayer++;

        const moving =
          await createTestAgent(
            "Moving Slot",
            {
              teamId:
                sourceTeam.id,
              layer,
              executionOrder:
                1,
            },
          );

        await createTestAgent(
          "Occupied Slot",
          {
            teamId:
              destinationTeam.id,
            layer,
            executionOrder:
              1,
          },
        );

        await expect(
          updateAgent(
            moving.id,
            {
              teamId:
                destinationTeam.id,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "already has an agent",
            ),
        });
      },
    );

    it(
      "allows an unrouted agent to move into a free destination slot",
      async () => {
        const sourceTeam =
          await createTestTeam(
            "free-source",
          );

        const destinationTeam =
          await createTestTeam(
            "free-destination",
          );

        const moving =
          await createTestAgent(
            "Free Move",
            {
              teamId:
                sourceTeam.id,
            },
          );

        const updated =
          await updateAgent(
            moving.id,
            {
              teamId:
                destinationTeam.id,
            },
          );

        expect(
          updated?.teamId,
        ).toBe(
          destinationTeam.id,
        );
      },
    );

    it(
      "edits outcome, destination, terminal action, and enabled state in place",
      async () => {
        const source =
          await createTestAgent(
            "Editor",
          );

        const target =
          await createTestAgent(
            "Editor Target",
          );

        const route =
          await createAgentRoute(
            source.id,
            {
              outcome:
                "changes_requested",
              targetAgentId:
                target.id,
              terminalAction:
                null,
              enabled:
                true,
            },
          );

        const terminalRoute =
          await updateAgentRoute(
            source.id,
            route.id,
            {
              outcome:
                "failed",
              targetAgentId:
                null,
              terminalAction:
                "fail_run",
              enabled:
                false,
            },
          );

        expect(
          terminalRoute,
        ).toMatchObject({
          id:
            route.id,
          outcome:
            "failed",
          targetAgentId:
            null,
          terminalAction:
            "fail_run",
          enabled:
            false,
        });
      },
    );

    it(
      "preserves historical executions and snapshots after safe deletion",
      async () => {
        const source =
          await createTestAgent(
            "Historical",
          );

        const target =
          await createTestAgent(
            "Historical Target",
          );

        await createAgentRoute(
          source.id,
          {
            outcome:
              "changes_requested",
            targetAgentId:
              target.id,
            terminalAction:
              null,
            enabled:
              true,
          },
        );

        await createAgentRoute(
          target.id,
          {
            outcome:
              "failed",
            targetAgentId:
              source.id,
            terminalAction:
              null,
            enabled:
              true,
          },
        );

        const workflowSnapshot = {
          agents: [
            {
              id:
                source.id,
              name:
                source.name,
              role:
                source.role,
            },
          ],
          routes: [],
        };

        const run =
          await createTestRun(
            workflowSnapshot,
            "completed",
          );

        const [execution] =
          await db
            .insert(
              agentExecutions,
            )
            .values({
              runId:
                run.id,
              agentId:
                source.id,
              agentName:
                source.name,
              agentRole:
                source.role,
              layer:
                source.layer,
              executionOrder:
                source.executionOrder,
              harness:
                source.harness,
              model:
                source.model,
              reasoning:
                source.reasoning,
              status:
                "completed",
              completedAt:
                new Date(),
            })
            .returning();

        expect(
          await deleteAgent(
            source.id,
          ),
        ).toBe(true);

        const [historicalExecution] =
          await db
            .select()
            .from(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.id,
                execution.id,
              ),
            );

        expect(
          historicalExecution,
        ).toMatchObject({
          id:
            execution.id,
          agentId:
            null,
          agentName:
            source.name,
          agentRole:
            source.role,
        });

        const [historicalRun] =
          await db
            .select()
            .from(runs)
            .where(
              eq(
                runs.id,
                run.id,
              ),
            );

        expect(
          historicalRun.workflowSnapshot,
        ).toEqual(
          workflowSnapshot,
        );
      },
    );

    it(
      "rejects deletion when an active run snapshot contains the agent",
      async () => {
        const source =
          await createTestAgent(
            "Active",
          );

        const run =
          await createTestRun(
            {
              agents: [
                {
                  id:
                    source.id,
                  name:
                    source.name,
                  role:
                    source.role,
                },
              ],
              routes: [],
            },
            "running",
          );

        await expect(
          deleteAgent(
            source.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              run.id,
            ),
        });
      },
    );
  },
);
