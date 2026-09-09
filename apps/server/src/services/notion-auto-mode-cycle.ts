import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";

import type {
  AgentResultStatus,
  Run,
} from "@orc/shared";

import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  runs,
  tasks,
} from "../db/schema.js";
import {
  createNotionTaskSourceAdapter,
  NotionTaskSourceError,
  type NotionTaskStatus,
} from "./notion-task-source.js";
import {
  getTeam,
} from "./team-service.js";
import {
  runAutoModeCycle,
  type AutoModeCycleDependencies,
  type AutoModeNotionAdapter,
} from "./auto-mode-service.js";

type PersistedRun =
  typeof runs.$inferSelect;

type LatestExecution = {
  resultStatus:
    AgentResultStatus | null;
};

export type NotionLifecycleTarget = {
  pageId:
    string;
  teamId:
    string;
  status:
    NotionTaskStatus | null;
};

type RunIntakeCycle = (
  dependencies?:
    AutoModeCycleDependencies,
) => Promise<void>;

export type NotionAutoModeCycleDependencies = {
  getLifecycleTarget?:
    () => Promise<NotionLifecycleTarget | null>;
  createNotionAdapter?:
    (
      teamId:
        string,
    ) => AutoModeNotionAdapter | Promise<AutoModeNotionAdapter>;
  runIntakeCycle?:
    RunIntakeCycle;
};

/**
 * Maps authoritative ORC run and latest-execution state to the supported Notion lifecycle projection.
 */
export function resolveNotionLifecycleStatus(
  runStatus:
    Run["status"],
  latestExecutionResultStatus:
    AgentResultStatus | null,
): NotionTaskStatus | null {
  if (
    runStatus === "pending" ||
    runStatus === "running"
  ) {
    return "In Progress";
  }

  if (
    runStatus === "blocked"
  ) {
    return "Blocked";
  }

  if (
    runStatus === "failed"
  ) {
    return "Failed";
  }

  if (
    runStatus === "cancelled"
  ) {
    return null;
  }

  if (
    runStatus === "completed" &&
    latestExecutionResultStatus === "approved"
  ) {
    return "Done";
  }

  return "In Progress";
}

/**
 * Loads the most recently updated Notion-sourced task that has acquired at least one run.
 */
async function getLatestNotionTaskWithRun() {
  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        sql`
          ${tasks.source} = 'notion'
          and ${tasks.externalId} is not null
          and exists (
            select 1
            from ${runs}
            where ${runs.taskId} = ${tasks.id}
          )
        `,
      )
      .orderBy(
        desc(
          sql`
            (
              select max(${runs.updatedAt})
              from ${runs}
              where ${runs.taskId} = ${tasks.id}
            )
          `,
        ),
        desc(
          tasks.updatedAt,
        ),
        desc(
          tasks.createdAt,
        ),
        desc(
          tasks.id,
        ),
      )
      .limit(1);

  return (
    task ??
    null
  );
}

/**
 * Loads the latest run owned by one persisted task, guarding that it still belongs to the expected Team.
 */
async function getLatestRunForTask(
  taskId:
    string,
  teamId:
    string,
): Promise<PersistedRun | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        and(
          eq(
            runs.taskId,
            taskId,
          ),
          eq(
            runs.teamId,
            teamId,
          ),
        ),
      )
      .orderBy(
        desc(
          runs.createdAt,
        ),
        desc(
          runs.id,
        ),
      )
      .limit(1);

  return (
    run ??
    null
  );
}

/**
 * Loads only the newest execution result for one run so an older approval can never override newer workflow state.
 */
async function getLatestExecutionForRun(
  runId:
    string,
): Promise<LatestExecution | null> {
  const [execution] =
    await db
      .select({
        resultStatus:
          agentExecutions.resultStatus,
      })
      .from(
        agentExecutions,
      )
      .where(
        eq(
          agentExecutions.runId,
          runId,
        ),
      )
      .orderBy(
        desc(
          agentExecutions.createdAt,
        ),
        desc(
          agentExecutions.id,
        ),
      )
      .limit(1);

  return (
    execution ??
    null
  );
}

/**
 * Derives the current Notion projection target entirely from persisted ORC workflow state.
 */
export async function getLatestNotionLifecycleTarget():
Promise<NotionLifecycleTarget | null> {
  const task =
    await getLatestNotionTaskWithRun();

  if (
    !task ||
    !task.externalId
  ) {
    return null;
  }

  const run =
    await getLatestRunForTask(
      task.id,
      task.teamId,
    );

  if (
    !run
  ) {
    return null;
  }

  const latestExecution =
    await getLatestExecutionForRun(
      run.id,
    );

  return {
    pageId:
      task.externalId,
    teamId:
      task.teamId,
    status:
      resolveNotionLifecycleStatus(
        run.status,
        latestExecution
          ?.resultStatus ??
          null,
      ),
  };
}

/**
 * Builds the production Notion adapter for one Team using its own configured data source.
 */
async function createProductionNotionAdapterForTeam(
  teamId:
    string,
): Promise<AutoModeNotionAdapter> {
  const team =
    await getTeam(
      teamId,
    );

  if (
    !team?.notionDataSourceId
  ) {
    throw new NotionTaskSourceError(
      "Notion lifecycle reconciliation requires a Team Notion data source.",
    );
  }

  return createNotionTaskSourceAdapter(
    team.notionDataSourceId,
  );
}

/**
 * Runs remote lifecycle reconciliation for the most recently active Notion-backed workflow, then runs the
 * existing multi-Team Auto Mode intake cycle so every automation-ready Team's queue is considered.
 */
export async function runNotionAutoModeCycle(
  dependencies:
    NotionAutoModeCycleDependencies = {},
): Promise<void> {
  const readLifecycleTarget =
    dependencies.getLifecycleTarget ??
    getLatestNotionLifecycleTarget;

  const createAdapterForIntake =
    dependencies.createNotionAdapter ??
    createProductionNotionAdapterForTeam;

  const intake =
    dependencies.runIntakeCycle ??
    runAutoModeCycle;

  const lifecycleTarget =
    await readLifecycleTarget();

  if (
    lifecycleTarget?.status
  ) {
    const adapter =
      await createAdapterForIntake(
        lifecycleTarget.teamId,
      );

    await adapter.updateStatus(
      lifecycleTarget.pageId,
      lifecycleTarget.status,
    );
  }

  await intake({
    createNotionAdapter:
      createAdapterForIntake,
  });
}
