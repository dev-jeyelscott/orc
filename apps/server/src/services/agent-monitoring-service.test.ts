import {
  eq,
  inArray,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  agentExecutions,
  agentRoutes,
  agents,
  domainEvents,
  runs,
  teams,
} from "../db/schema.js";
import {
  getAgentObservability,
  listAgentMonitoringOverview,
} from "./agent-monitoring-service.js";

const createdAgentIds =
  new Set<string>();

const createdRouteIds =
  new Set<string>();

const createdRunIds =
  new Set<string>();

const createdExecutionIds =
  new Set<string>();

const createdEventIds =
  new Set<string>();

const createdTeamIds =
  new Set<string>();

let nextLayer =
  500_000 +
  Math.floor(
    Math.random() *
      100_000_000,
  );

/**
 * Creates and tracks one disposable Team for monitoring isolation tests.
 */
async function createTestTeam(
  label: string,
) {
  const [team] =
    await db
      .insert(teams)
      .values({
        slug:
          `monitor-${label.toLowerCase()}-${crypto.randomUUID()}`,
        name:
          `Monitor ${label}`,
      })
      .returning();

  createdTeamIds.add(
    team.id,
  );

  return team;
}

/**
 * Creates a uniquely ordered generic Agent for monitoring tests.
 */
async function createTestAgent(
  label: string,
  enabled = true,
  teamId =
    RESOLUTION_TEAM_ID,
) {
  const [agent] =
    await db
      .insert(agents)
      .values({
        teamId,
        slug:
          `monitor-${label.toLowerCase()}-${crypto.randomUUID()}`,
        name:
          `Monitor ${label}`,
        role:
          `${label} Role`,
        description:
          `${label} monitoring agent`,
        layer:
          nextLayer++,
        executionOrder: 1,
        harness: "codex",
        model: "default",
        reasoning: "high",
        systemPrompt:
          `Act as ${label}.`,
        enabled,
        canWrite: false,
        canRunCommands: true,
        canCommit: false,
      })
      .returning();

  createdAgentIds.add(
    agent.id,
  );

  return agent;
}

/**
 * Creates a route and tracks it for deterministic cleanup.
 */
async function createTestRoute(
  sourceAgentId: string,
  targetAgentId: string,
) {
  const [route] =
    await db
      .insert(
        agentRoutes,
      )
      .values({
        sourceAgentId,
        outcome:
          "changes_requested",
        targetAgentId,
        terminalAction: null,
        enabled: true,
      })
      .returning();

  createdRouteIds.add(
    route.id,
  );

  return route;
}

/**
 * Creates one persisted Run for a specific Team.
 */
async function createTestRun(
  teamId =
    RESOLUTION_TEAM_ID,
) {
  const [run] =
    await db
      .insert(runs)
      .values({
        teamId,
        projectPath:
          `/tmp/orc-agent-monitoring-${crypto.randomUUID()}`,
        status:
          "completed",
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  return run;
}

/**
 * Builds a valid structured Agent result for one persisted result status.
 */
function createResult(
  status:
    | "completed"
    | "approved"
    | "changes_requested"
    | "blocked"
    | "failed",
) {
  return {
    status,
    summary:
      `Result ${status}`,
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
  };
}

/**
 * Creates one tracked execution with configurable timestamps and telemetry.
 */
async function createTestExecution(
  agent:
    typeof agents.$inferSelect,
  run:
    typeof runs.$inferSelect,
  input: {
    status:
      | "starting"
      | "running"
      | "completed"
      | "failed"
      | "blocked"
      | "cancelled";
    resultStatus?:
      | "completed"
      | "approved"
      | "changes_requested"
      | "blocked"
      | "failed"
      | null;
    createdAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    tokenUsage?: unknown;
    contextUsage?: unknown;
    exitCode?: number | null;
  },
) {
  const resultStatus =
    input.resultStatus ??
    null;

  const [execution] =
    await db
      .insert(
        agentExecutions,
      )
      .values({
        runId:
          run.id,
        agentId:
          agent.id,
        agentName:
          agent.name,
        agentRole:
          agent.role,
        layer:
          agent.layer,
        executionOrder:
          agent.executionOrder,
        harness:
          agent.harness,
        model:
          agent.model,
        reasoning:
          agent.reasoning,
        status:
          input.status,
        startedAt:
          input.startedAt ??
          null,
        completedAt:
          input.completedAt ??
          null,
        exitCode:
          input.exitCode ??
          null,
        resultStatus,
        resultPayload:
          resultStatus
            ? createResult(
                resultStatus,
              )
            : null,
        tokenUsage:
          input.tokenUsage ??
          null,
        contextUsage:
          input.contextUsage ??
          null,
        createdAt:
          input.createdAt,
        updatedAt:
          input.completedAt ??
          input.createdAt,
      })
      .returning();

  createdExecutionIds.add(
    execution.id,
  );

  return execution;
}

/**
 * Persists one execution-associated event used to verify event correlation.
 */
async function createTestEvent(
  executionId: string,
  run:
    typeof runs.$inferSelect,
  status:
    | "approved"
    | "changes_requested" =
    "approved",
) {
  const [event] =
    await db
      .insert(
        domainEvents,
      )
      .values({
        type:
          "result.received",
        projectPath:
          run.projectPath,
        runId:
          run.id,
        agentExecutionId:
          executionId,
        data: {
          status,
        },
      })
      .returning();

  createdEventIds.add(
    event.id,
  );

  return event;
}

/**
 * Removes every row created by one monitoring test without touching seeded application data.
 */
async function cleanupCreatedRows() {
  if (
    createdEventIds.size >
    0
  ) {
    await db
      .delete(
        domainEvents,
      )
      .where(
        inArray(
          domainEvents.id,
          [
            ...createdEventIds,
          ],
        ),
      );
  }

  if (
    createdExecutionIds.size >
    0
  ) {
    await db
      .delete(
        agentExecutions,
      )
      .where(
        inArray(
          agentExecutions.id,
          [
            ...createdExecutionIds,
          ],
        ),
      );
  }

  if (
    createdRunIds.size >
    0
  ) {
    await db
      .delete(
        runs,
      )
      .where(
        inArray(
          runs.id,
          [
            ...createdRunIds,
          ],
        ),
      );
  }

  if (
    createdRouteIds.size >
    0
  ) {
    await db
      .delete(
        agentRoutes,
      )
      .where(
        inArray(
          agentRoutes.id,
          [
            ...createdRouteIds,
          ],
        ),
      );
  }

  if (
    createdAgentIds.size >
    0
  ) {
    await db
      .delete(
        agents,
      )
      .where(
        inArray(
          agents.id,
          [
            ...createdAgentIds,
          ],
        ),
      );
  }

  if (
    createdTeamIds.size >
    0
  ) {
    await db
      .delete(
        teams,
      )
      .where(
        inArray(
          teams.id,
          [
            ...createdTeamIds,
          ],
        ),
      );
  }

  createdEventIds.clear();
  createdExecutionIds.clear();
  createdRunIds.clear();
  createdRouteIds.clear();
  createdAgentIds.clear();
  createdTeamIds.clear();
}

afterEach(
  cleanupCreatedRows,
);

describe(
  "agent monitoring service",
  () => {
    it(
      "returns the complete route projection and detects an enabled route targeting a disabled Agent",
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
          await createTestRoute(
            source.id,
            target.id,
          );

        await db
          .update(agents)
          .set({
            enabled:
              false,
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              agents.id,
              target.id,
            ),
          );

        const overview =
          await listAgentMonitoringOverview(
            "7d",
          );

        const projectedSource =
          overview.agents.find(
            (agent) =>
              agent.id ===
              source.id,
          );

        expect(
          projectedSource
            ?.routes.some(
              (candidate) =>
                candidate.id ===
                route.id,
            ),
        ).toBe(true);

        expect(
          overview
            .validationIssues,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                "enabled_route_targets_disabled_agent",
              sourceAgentId:
                source.id,
              targetAgentId:
                target.id,
              routeId:
                route.id,
            }),
          ]),
        );
      },
    );

    it(
      "isolates configuration, metrics, validation, results, and events by Team",
      async () => {
        const firstTeam =
          await createTestTeam(
            "First Team",
          );

        const secondTeam =
          await createTestTeam(
            "Second Team",
          );

        const firstSource =
          await createTestAgent(
            "First Source",
            true,
            firstTeam.id,
          );

        const firstTarget =
          await createTestAgent(
            "First Target",
            false,
            firstTeam.id,
          );

        const secondSource =
          await createTestAgent(
            "Second Source",
            true,
            secondTeam.id,
          );

        const secondTarget =
          await createTestAgent(
            "Second Target",
            false,
            secondTeam.id,
          );

        const firstRoute =
          await createTestRoute(
            firstSource.id,
            firstTarget.id,
          );

        const secondRoute =
          await createTestRoute(
            secondSource.id,
            secondTarget.id,
          );

        const firstRun =
          await createTestRun(
            firstTeam.id,
          );

        const secondRun =
          await createTestRun(
            secondTeam.id,
          );

        const now =
          Date.now();

        const firstExecution =
          await createTestExecution(
            firstSource,
            firstRun,
            {
              status:
                "running",
              createdAt:
                new Date(
                  now -
                    30_000,
                ),
              startedAt:
                new Date(
                  now -
                    30_000,
                ),
            },
          );

        const firstResultRun =
          await createTestRun(
            firstTeam.id,
          );

        const firstResult =
          await createTestExecution(
            firstSource,
            firstResultRun,
            {
              status:
                "completed",
              resultStatus:
                "approved",
              createdAt:
                new Date(
                  now -
                    60_000,
                ),
              startedAt:
                new Date(
                  now -
                    60_000,
                ),
              completedAt:
                new Date(
                  now -
                    50_000,
                ),
            },
          );

        const secondExecution =
          await createTestExecution(
            secondSource,
            secondRun,
            {
              status:
                "running",
              createdAt:
                new Date(
                  now -
                    25_000,
                ),
              startedAt:
                new Date(
                  now -
                    25_000,
                ),
            },
          );

        const secondResultRun =
          await createTestRun(
            secondTeam.id,
          );

        const secondResult =
          await createTestExecution(
            secondSource,
            secondResultRun,
            {
              status:
                "completed",
              resultStatus:
                "changes_requested",
              createdAt:
                new Date(
                  now -
                    55_000,
                ),
              startedAt:
                new Date(
                  now -
                    55_000,
                ),
              completedAt:
                new Date(
                  now -
                    45_000,
                ),
            },
          );

        await createTestEvent(
          firstResult.id,
          firstResultRun,
          "approved",
        );

        await createTestEvent(
          secondResult.id,
          secondResultRun,
          "changes_requested",
        );

        const overview =
          await listAgentMonitoringOverview(
            "7d",
            firstTeam.id,
          );

        expect(
          overview.agents.map(
            (agent) =>
              agent.id,
          ),
        ).toEqual(
          expect.arrayContaining([
            firstSource.id,
            firstTarget.id,
          ]),
        );

        expect(
          overview.agents.some(
            (agent) =>
              agent.id ===
              secondSource.id ||
              agent.id ===
              secondTarget.id,
          ),
        ).toBe(false);

        expect(
          overview.metrics,
        ).toMatchObject({
          totalAgents: 2,
          enabledAgents: 1,
          activeExecutions: 1,
          activeRuns: 1,
          enabledRouteRules: 1,
          approvedResults: 1,
          changesRequestedResults:
            0,
        });

        expect(
          overview
            .validationIssues,
        ).toEqual([
          expect.objectContaining({
            routeId:
              firstRoute.id,
            sourceAgentId:
              firstSource.id,
            targetAgentId:
              firstTarget.id,
          }),
        ]);

        expect(
          overview
            .validationIssues.some(
              (issue) =>
                issue.routeId ===
                secondRoute.id,
            ),
        ).toBe(false);

        expect(
          overview
            .recentEvents.some(
              (event) =>
                event.runId ===
                secondRun.id ||
                event.runId ===
                secondResultRun.id,
            ),
        ).toBe(false);

        expect(
          firstExecution.id,
        ).toEqual(
          expect.any(
            String,
          ),
        );

        expect(
          secondExecution.id,
        ).toEqual(
          expect.any(
            String,
          ),
        );
      },
    );

    it(
      "aggregates selected-Agent execution state and only trustworthy usage telemetry",
      async () => {
        const agent =
          await createTestAgent(
            "Aggregate",
          );

        const firstRun =
          await createTestRun();

        const secondRun =
          await createTestRun();

        const activeRun =
          await createTestRun();

        const now =
          Date.now();

        const approved =
          await createTestExecution(
            agent,
            firstRun,
            {
              status:
                "completed",
              resultStatus:
                "approved",
              createdAt:
                new Date(
                  now -
                    10 *
                      60 *
                      1000,
                ),
              startedAt:
                new Date(
                  now -
                    10 *
                      60 *
                      1000,
                ),
              completedAt:
                new Date(
                  now -
                    8 *
                      60 *
                      1000,
                ),
              tokenUsage: {
                input_tokens:
                  100,
                output_tokens:
                  50,
              },
              contextUsage: {
                used_tokens:
                  250,
                limit_tokens:
                  1000,
              },
              exitCode: 0,
            },
          );

        await createTestExecution(
          agent,
          secondRun,
          {
            status:
              "completed",
            resultStatus:
              "changes_requested",
            createdAt:
              new Date(
                now -
                  5 *
                    60 *
                    1000,
              ),
            startedAt:
              new Date(
                now -
                  5 *
                    60 *
                    1000,
              ),
            completedAt:
              new Date(
                now -
                  4 *
                    60 *
                    1000,
              ),
            tokenUsage: {
              total_tokens:
                300,
            },
            contextUsage: {
              percent:
                60,
            },
            exitCode: 0,
          },
        );

        await createTestExecution(
          agent,
          activeRun,
          {
            status:
              "running",
            createdAt:
              new Date(
                now -
                  20 *
                    1000,
              ),
            startedAt:
              new Date(
                now -
                  20 *
                    1000,
              ),
          },
        );

        await createTestEvent(
          approved.id,
          firstRun,
        );

        const observability =
          await getAgentObservability(
            agent.id,
            "7d",
          );

        expect(
          observability,
        ).toMatchObject({
          totalExecutions: 3,
          activeExecutionCount:
            1,
          successfulResults: 1,
          resultCount: 2,
          approvedResults: 1,
          changesRequestedResults:
            1,
          averageDurationMs:
            90_000,
          averageTokens: 225,
          tokenTelemetryExecutions:
            2,
          contextUsagePercent:
            60,
          contextTelemetryExecutions:
            2,
          latestExitCode: 0,
          lastActiveRunId:
            activeRun.id,
        });

        expect(
          observability
            ?.activeExecution
            ?.runId,
        ).toBe(
          activeRun.id,
        );

        expect(
          observability
            ?.recentEvents,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id:
                expect.any(
                  String,
                ),
              agentExecutionId:
                approved.id,
            }),
          ]),
        );
      },
    );

    it(
      "excludes old terminal history from the selected range and reports unsupported telemetry as unavailable",
      async () => {
        const agent =
          await createTestAgent(
            "Range",
          );

        const oldRun =
          await createTestRun();

        const recentRun =
          await createTestRun();

        const now =
          Date.now();

        await createTestExecution(
          agent,
          oldRun,
          {
            status:
              "completed",
            resultStatus:
              "completed",
            createdAt:
              new Date(
                now -
                  35 *
                    24 *
                    60 *
                    60 *
                    1000,
              ),
            startedAt:
              new Date(
                now -
                  35 *
                    24 *
                    60 *
                    60 *
                    1000,
              ),
            completedAt:
              new Date(
                now -
                  35 *
                    24 *
                    60 *
                    60 *
                    1000 +
                  60_000,
              ),
            tokenUsage: {
              total_tokens:
                999,
            },
          },
        );

        await createTestExecution(
          agent,
          recentRun,
          {
            status:
              "completed",
            resultStatus:
              "completed",
            createdAt:
              new Date(
                now -
                  60_000,
              ),
            startedAt:
              new Date(
                now -
                  60_000,
              ),
            completedAt:
              new Date(
                now -
                  30_000,
              ),
            tokenUsage: {
              mystery:
                100,
            },
            contextUsage: {
              unsupported:
                50,
            },
          },
        );

        const observability =
          await getAgentObservability(
            agent.id,
            "7d",
          );

        expect(
          observability,
        ).toMatchObject({
          totalExecutions: 1,
          averageTokens: null,
          tokenTelemetryExecutions:
            0,
          contextUsagePercent:
            null,
          contextTelemetryExecutions:
            0,
        });
      },
    );
  },
);
