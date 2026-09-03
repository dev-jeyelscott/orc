import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "../db/client.js";
import {
  runs,
  tasks,
} from "../db/schema.js";
import {
  getRunMonitoringDetail,
  listRunMonitoringSummaries,
  projectExecutionPlan,
} from "./run-monitoring-service.js";

const createdRunIds =
  new Set<string>();

const createdTaskIds =
  new Set<string>();

/**
 * Creates one snapshot agent containing both public and private configuration fields.
 */
function createSnapshotAgent(
  input: {
    name: string;
    layer: number;
    executionOrder: number;
  },
) {
  return {
    id: crypto.randomUUID(),
    name: input.name,
    role:
      `${input.name} Role`,
    layer: input.layer,
    executionOrder:
      input.executionOrder,
    harness:
      "codex" as const,
    model: "default",
    reasoning: "high",
    systemPrompt:
      `Secret ${input.name} prompt`,
    canWrite: true,
    canRunCommands: true,
    canCommit: false,
  };
}

/**
 * Creates one persisted run with an immutable workflow snapshot for monitoring tests.
 */
async function createMonitoringRun() {
  const first =
    createSnapshotAgent({
      name: "First Agent",
      layer: 1,
      executionOrder: 1,
    });

  const second =
    createSnapshotAgent({
      name: "Second Agent",
      layer: 2,
      executionOrder: 1,
    });

  const projectPath =
    `/tmp/orc-monitoring-${crypto.randomUUID()}`;

  const [task] = await db
    .insert(tasks)
    .values({
      projectPath,
      title:
        "Monitoring test task",
      instruction:
        "Validate the monitoring read model.",
      status: "running",
    })
    .returning();

  createdTaskIds.add(task.id);

  const [run] = await db
    .insert(runs)
    .values({
      taskId: task.id,
      projectPath,
      status: "running",
      workflowSnapshot: {
        agents: [
          second,
          first,
        ],
        routes: [],
      },
      currentAgentId:
        first.id,
      executionCount: 1,
    })
    .returning();

  createdRunIds.add(run.id);

  return {
    run,
    task,
    first,
    second,
  };
}

afterEach(async () => {
  for (
    const id of
    createdRunIds
  ) {
    await db
      .delete(runs)
      .where(eq(runs.id, id));
  }

  for (
    const id of
    createdTaskIds
  ) {
    await db
      .delete(tasks)
      .where(eq(tasks.id, id));
  }

  createdRunIds.clear();
  createdTaskIds.clear();
});

describe(
  "run monitoring service",
  () => {
    it(
      "projects snapshot agents without exposing private configuration",
      () => {
        const agent =
          createSnapshotAgent({
            name:
              "Projection Agent",
            layer: 2,
            executionOrder: 3,
          });

        const plan =
          projectExecutionPlan({
            agents: [agent],
            routes: [],
          });

        expect(plan).toEqual([
          {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            layer: agent.layer,
            executionOrder:
              agent.executionOrder,
            harness:
              agent.harness,
            model: agent.model,
            reasoning:
              agent.reasoning,
          },
        ]);

        expect(
          "systemPrompt" in
            plan[0],
        ).toBe(false);

        expect(
          "canWrite" in
            plan[0],
        ).toBe(false);
      },
    );

    it(
      "returns an empty plan for an unavailable or malformed snapshot",
      () => {
        expect(
          projectExecutionPlan(
            null,
          ),
        ).toEqual([]);

        expect(
          projectExecutionPlan({
            agents:
              "invalid",
          }),
        ).toEqual([]);
      },
    );

    it(
      "joins task metadata and resolves the current snapshot agent",
      async () => {
        const {
          run,
          first,
        } =
          await createMonitoringRun();

        const summaries =
          await listRunMonitoringSummaries();

        const summary =
          summaries.find(
            (candidate) =>
              candidate.id ===
              run.id,
          );

        expect(summary).toMatchObject(
          {
            id: run.id,
            taskTitle:
              "Monitoring test task",
            plannedExecutionCount:
              2,
            currentAgent: {
              id: first.id,
              name:
                first.name,
            },
          },
        );
      },
    );

    it(
      "adds the safe execution plan to the existing run detail",
      async () => {
        const {
          run,
        } =
          await createMonitoringRun();

        const detail =
          await getRunMonitoringDetail(
            run.id,
          );

        expect(
          detail?.executionPlan.map(
            (agent) =>
              agent.name,
          ),
        ).toEqual([
          "First Agent",
          "Second Agent",
        ]);

        expect(
          detail?.task?.title,
        ).toBe(
          "Monitoring test task",
        );
      },
    );
  },
);
