import {
  desc,
  eq,
} from "drizzle-orm";
import { z } from "zod";

import {
  workflowPlanAgentSchema,
  type RunMonitoringDetail,
  type RunMonitoringSummary,
  type WorkflowPlanAgent,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  runs,
  tasks,
} from "../db/schema.js";
import { getRunDetail } from "./workflow-service.js";

const workflowSnapshotProjectionSchema = z
  .object({
    agents: z.array(
      workflowPlanAgentSchema,
    ),
  })
  .passthrough();

/**
 * Converts an immutable workflow snapshot into the safe agent plan exposed to operators.
 */
export function projectExecutionPlan(
  snapshot: unknown,
): WorkflowPlanAgent[] {
  const parsed =
    workflowSnapshotProjectionSchema.safeParse(
      snapshot,
    );

  if (!parsed.success) {
    return [];
  }

  return [...parsed.data.agents].sort(
    (left, right) =>
      left.layer - right.layer ||
      left.executionOrder -
        right.executionOrder,
  );
}

/**
 * Returns monitoring summaries for persisted runs without issuing per-run detail queries.
 */
export async function listRunMonitoringSummaries(): Promise<
  RunMonitoringSummary[]
> {
  const rows = await db
    .select({
      id: runs.id,
      taskId: runs.taskId,
      teamId: runs.teamId,
      projectPath: runs.projectPath,
      status: runs.status,
      workflowSnapshot:
        runs.workflowSnapshot,
      currentAgentId:
        runs.currentAgentId,
      executionCount:
        runs.executionCount,
      terminalReason:
        runs.terminalReason,
      createdAt: runs.createdAt,
      updatedAt: runs.updatedAt,
      taskTitle: tasks.title,
    })
    .from(runs)
    .leftJoin(
      tasks,
      eq(
        runs.taskId,
        tasks.id,
      ),
    )
    .orderBy(
      desc(
        runs.createdAt,
      ),
    );

  return rows.map(
    (row) => {
      const executionPlan =
        projectExecutionPlan(
          row.workflowSnapshot,
        );

      const currentAgent =
        row.currentAgentId
          ? executionPlan.find(
              (agent) =>
                agent.id ===
                row.currentAgentId,
            ) ?? null
          : null;

      return {
        id: row.id,
        taskId:
          row.taskId ?? null,
        teamId:
          row.teamId,
        projectPath:
          row.projectPath,
        status:
          row.status,
        currentAgentId:
          row.currentAgentId ??
          null,
        executionCount:
          row.executionCount,
        terminalReason:
          row.terminalReason ??
          null,
        createdAt:
          row.createdAt.toISOString(),
        updatedAt:
          row.updatedAt.toISOString(),
        taskTitle:
          row.taskTitle ?? null,
        plannedExecutionCount:
          executionPlan.length,
        currentAgent,
      };
    },
  );
}

/**
 * Loads the existing run detail and adds the safe immutable execution plan needed by the monitoring UI.
 */
export async function getRunMonitoringDetail(
  id: string,
): Promise<RunMonitoringDetail | null> {
  const [
    detail,
    snapshotRows,
  ] = await Promise.all([
    getRunDetail(
      id,
    ),
    db
      .select({
        workflowSnapshot:
          runs.workflowSnapshot,
      })
      .from(runs)
      .where(
        eq(
          runs.id,
          id,
        ),
      )
      .limit(1),
  ]);

  if (!detail) {
    return null;
  }

  return {
    ...detail,
    executionPlan:
      projectExecutionPlan(
        snapshotRows[0]
          ?.workflowSnapshot ??
          null,
      ),
  };
}
