import {
  desc,
  eq,
  sql,
} from "drizzle-orm";

import type {
  AgentResultStatus,
  Run,
  SystemSettings,
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
  type NotionTaskStatus,
} from "./notion-task-source.js";
import {
  getSystemSettings,
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
  status:
    NotionTaskStatus | null;
};

type RunIntakeCycle = (
  dependencies?:
    AutoModeCycleDependencies,
) => Promise<void>;

export type NotionAutoModeCycleDependencies = {
  getSettings?:
    () => Promise<SystemSettings>;
  getLifecycleTarget?:
    () => Promise<NotionLifecycleTarget | null>;
  createNotionAdapter?:
    () => AutoModeNotionAdapter;
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
 * Loads the latest run owned by one persisted task without falling back to older workflow attempts.
 */
async function getLatestRunForTask(
  taskId:
    string,
): Promise<PersistedRun | null> {
  const [run] =
    await db
      .select()
      .from(runs)
      .where(
        eq(
          runs.taskId,
          taskId,
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
 * Runs remote lifecycle reconciliation before allowing the existing Auto Mode intake path to claim more work.
 */
export async function runNotionAutoModeCycle(
  dependencies:
    NotionAutoModeCycleDependencies = {},
): Promise<void> {
  const readSettings =
    dependencies.getSettings ??
    getSystemSettings;

  const readLifecycleTarget =
    dependencies.getLifecycleTarget ??
    getLatestNotionLifecycleTarget;

  const createAdapter =
    dependencies.createNotionAdapter ??
    createNotionTaskSourceAdapter;

  const intake =
    dependencies.runIntakeCycle ??
    runAutoModeCycle;

  const lifecycleTarget =
    await readLifecycleTarget();

  let adapter:
    AutoModeNotionAdapter | null =
    null;

  if (
    lifecycleTarget?.status
  ) {
    adapter =
      createAdapter();

    await adapter.updateStatus(
      lifecycleTarget.pageId,
      lifecycleTarget.status,
    );
  }

  const settings =
    await readSettings();

  if (
    !settings.autoModeEnabled
  ) {
    return;
  }

  await intake(
    adapter
      ? {
          createNotionAdapter:
            () =>
              adapter,
        }
      : {},
  );
}
