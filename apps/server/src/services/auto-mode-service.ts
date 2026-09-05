import {
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";

import type {
  AgentResultStatus,
  AutomationStatus,
  Run,
  SystemSettings,
  UpdateSystemSettings,
} from "@orc/shared";

import {
  env,
} from "../config/env.js";
import {
  db,
} from "../db/client.js";
import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  agentExecutions,
  runs,
  systemSettings,
  tasks,
} from "../db/schema.js";
import {
  createNotionTaskSourceAdapter,
  type NotionTaskCandidate,
  type NotionTaskSourceAdapter,
} from "./notion-task-source.js";
import {
  startTask,
} from "./workflow-service.js";

type PersistedTask =
  typeof tasks.$inferSelect;

type PersistedRun =
  typeof runs.$inferSelect;

type EligibilityExecution = {
  resultStatus:
    AgentResultStatus | null;
  completedAt:
    Date | null;
};

export type AutoModeEligibilitySnapshot =
  | {
      runStatus:
        Run["status"];
      latestExecution:
        EligibilityExecution | null;
    }
  | null;

export type AutoModeEligibility = {
  eligible:
    boolean;
  state:
    Exclude<
      AutomationStatus["state"],
      "off"
    >;
  nextEligibleAt:
    Date | null;
};

export type AutoModeNotionAdapter =
  Pick<
    NotionTaskSourceAdapter,
    | "getNextReadyTask"
    | "updateStatus"
  >;

type StartExistingTask =
  (
    id:
      string,
  ) => Promise<unknown | null>;

type CanClaimTask =
  () => Promise<boolean>;

export type AutoModeCycleDependencies = {
  getSettings?:
    () => Promise<SystemSettings>;
  evaluateEligibility?:
    (
      now?:
        Date,
    ) => Promise<AutoModeEligibility>;
  isEnabled?:
    () => Promise<boolean>;
  createNotionAdapter?:
    () => AutoModeNotionAdapter;
  startExistingTask?:
    StartExistingTask;
};

/**
 * Serializes the singleton database row into the shared system-settings contract.
 */
function serializeSystemSettings(
  row:
    typeof systemSettings.$inferSelect,
): SystemSettings {
  return {
    autoModeEnabled:
      row.autoModeEnabled,
  };
}

/**
 * Loads the singleton settings row, recreating the default singleton only if it is unexpectedly absent.
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const [existing] =
    await db
      .select()
      .from(
        systemSettings,
      )
      .where(
        eq(
          systemSettings.id,
          1,
        ),
      );

  if (
    existing
  ) {
    return serializeSystemSettings(
      existing,
    );
  }

  await db
    .insert(
      systemSettings,
    )
    .values({
      id:
        1,
      autoModeEnabled:
        false,
    })
    .onConflictDoNothing();

  const [created] =
    await db
      .select()
      .from(
        systemSettings,
      )
      .where(
        eq(
          systemSettings.id,
          1,
        ),
      );

  if (
    !created
  ) {
    throw new Error(
      "Unable to load system settings",
    );
  }

  return serializeSystemSettings(
    created,
  );
}

/**
 * Persists the complete Auto Mode setting on the singleton system-settings row.
 */
export async function updateSystemSettings(
  input:
    UpdateSystemSettings,
): Promise<SystemSettings> {
  const now =
    new Date();

  const [updated] =
    await db
      .insert(
        systemSettings,
      )
      .values({
        id:
          1,
        autoModeEnabled:
          input.autoModeEnabled,
        updatedAt:
          now,
      })
      .onConflictDoUpdate({
        target:
          systemSettings.id,
        set: {
          autoModeEnabled:
            input.autoModeEnabled,
          updatedAt:
            now,
        },
      })
      .returning();

  return serializeSystemSettings(
    updated,
  );
}

/**
 * Converts the latest persisted run and execution state into the Auto Mode eligibility rule.
 */
export function resolveAutoModeEligibility(
  snapshot:
    AutoModeEligibilitySnapshot,
  now:
    Date,
  postApprovalDelaySeconds:
    number,
): AutoModeEligibility {
  if (
    !snapshot
  ) {
    return {
      eligible:
        true,
      state:
        "ready",
      nextEligibleAt:
        null,
    };
  }

  if (
    snapshot.runStatus ===
      "pending" ||
    snapshot.runStatus ===
      "running"
  ) {
    return {
      eligible:
        false,
      state:
        "running",
      nextEligibleAt:
        null,
    };
  }

  if (
    snapshot.runStatus !==
    "completed"
  ) {
    return {
      eligible:
        false,
      state:
        "waiting_approval",
      nextEligibleAt:
        null,
    };
  }

  if (
    !snapshot.latestExecution ||
    snapshot.latestExecution
      .resultStatus !==
      "approved" ||
    !snapshot.latestExecution
      .completedAt
  ) {
    return {
      eligible:
        false,
      state:
        "waiting_approval",
      nextEligibleAt:
        null,
    };
  }

  const nextEligibleAt =
    new Date(
      snapshot.latestExecution
        .completedAt.getTime() +
        postApprovalDelaySeconds *
          1_000,
    );

  if (
    now.getTime() <
    nextEligibleAt.getTime()
  ) {
    return {
      eligible:
        false,
      state:
        "cooldown",
      nextEligibleAt,
    };
  }

  return {
    eligible:
      true,
    state:
      "ready",
    nextEligibleAt:
      null,
  };
}

/**
 * Finds any currently active workflow before historical approval state is considered.
 */
async function getActiveRunSnapshot(): Promise<AutoModeEligibilitySnapshot> {
  const [activeRun] =
    await db
      .select({
        status:
          runs.status,
      })
      .from(runs)
      .where(
        inArray(
          runs.status,
          [
            "pending",
            "running",
          ],
        ),
      )
      .orderBy(
        desc(
          runs.updatedAt,
        ),
        desc(
          runs.createdAt,
        ),
        desc(
          runs.id,
        ),
      )
      .limit(1);

  if (
    !activeRun
  ) {
    return null;
  }

  return {
    runStatus:
      activeRun.status,
    latestExecution:
      null,
  };
}

/**
 * Finds the task whose persisted workflow activity was updated most recently.
 */
async function getMostRecentlyExecutedTaskId(): Promise<string | null> {
  const [activity] =
    await db
      .select({
        taskId:
          runs.taskId,
      })
      .from(runs)
      .where(
        isNotNull(
          runs.taskId,
        ),
      )
      .orderBy(
        desc(
          runs.updatedAt,
        ),
        desc(
          runs.createdAt,
        ),
        desc(
          runs.id,
        ),
      )
      .limit(1);

  return (
    activity?.taskId ??
    null
  );
}

/**
 * Loads the newest run belonging to one task.
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
 * Loads the latest execution of one run without falling back to an older approved execution.
 */
async function getLatestExecutionForRun(
  runId:
    string,
): Promise<EligibilityExecution | null> {
  const [execution] =
    await db
      .select({
        resultStatus:
          agentExecutions.resultStatus,
        completedAt:
          agentExecutions.completedAt,
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
 * Builds the persisted snapshot used by the eligibility gate, with active workflows taking precedence over history.
 */
async function getAutoModeEligibilitySnapshot(): Promise<AutoModeEligibilitySnapshot> {
  const activeRun =
    await getActiveRunSnapshot();

  if (
    activeRun
  ) {
    return activeRun;
  }

  const taskId =
    await getMostRecentlyExecutedTaskId();

  if (
    !taskId
  ) {
    return null;
  }

  const latestRun =
    await getLatestRunForTask(
      taskId,
    );

  if (
    !latestRun
  ) {
    return null;
  }

  return {
    runStatus:
      latestRun.status,
    latestExecution:
      await getLatestExecutionForRun(
        latestRun.id,
      ),
  };
}

/**
 * Evaluates Auto Mode eligibility entirely from persisted PostgreSQL state.
 */
export async function evaluateAutoModeEligibility(
  now:
    Date = new Date(),
): Promise<AutoModeEligibility> {
  return resolveAutoModeEligibility(
    await getAutoModeEligibilitySnapshot(),
    now,
    env.NOTION_POST_APPROVAL_DELAY_SECONDS,
  );
}

/**
 * Reads the current persisted Auto Mode switch without consulting process-local scheduler state.
 */
async function isAutoModeEnabled(): Promise<boolean> {
  return (
    await getSystemSettings()
  ).autoModeEnabled;
}

/**
 * Returns the operator-facing automation state derived only from persisted settings and workflow history.
 */
export async function getAutomationStatus(): Promise<AutomationStatus> {
  const settings =
    await getSystemSettings();

  if (
    !settings.autoModeEnabled
  ) {
    return {
      state:
        "off",
      nextEligibleAt:
        null,
    };
  }

  const eligibility =
    await evaluateAutoModeEligibility();

  return {
    state:
      eligibility.state,
    nextEligibleAt:
      eligibility.nextEligibleAt
        ?.toISOString() ??
      null,
  };
}

/**
 * Finds the highest-priority locally persisted pending Notion task that has never acquired a run, with oldest-first deterministic tie-breaking.
 */
async function findRecoverablePendingNotionTask(): Promise<PersistedTask | null> {
  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        sql`
          ${tasks.source} = 'notion'
          and ${tasks.status} = 'pending'
          and not exists (
            select 1
            from ${runs}
            where ${runs.taskId} = ${tasks.id}
          )
        `,
      )
      .orderBy(
        desc(
          tasks.priority,
        ),
        asc(
          tasks.createdAt,
        ),
        asc(
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
 * Loads an existing locally persisted Notion task by its idempotency identity.
 */
async function findNotionTaskByExternalId(
  externalId:
    string,
): Promise<PersistedTask | null> {
  const [task] =
    await db
      .select()
      .from(tasks)
      .where(
        sql`
          ${tasks.source} = 'notion'
          and ${tasks.externalId} = ${externalId}
        `,
      )
      .limit(1);

  return (
    task ??
    null
  );
}

/**
 * Persists one validated Notion candidate before any remote claim update and reports whether this cycle inserted it.
 */
async function persistNotionCandidate(
  candidate:
    NotionTaskCandidate,
): Promise<{
  task:
    PersistedTask;
  inserted:
    boolean;
}> {
  const [inserted] =
    await db
      .insert(tasks)
      .values({
        teamId:
          RESOLUTION_TEAM_ID,
        projectPath:
          candidate.project.path,
        title:
          candidate.title,
        instruction:
          candidate.instruction,
        status:
          "pending",
        source:
          "notion",
        externalId:
          candidate.externalId,
        externalUrl:
          candidate.externalUrl,
        priority:
          candidate.priority,
      })
      .onConflictDoNothing({
        target: [
          tasks.source,
          tasks.externalId,
        ],
      })
      .returning();

  if (
    inserted
  ) {
    return {
      task:
        inserted,
      inserted:
        true,
    };
  }

  const existing =
    await findNotionTaskByExternalId(
      candidate.externalId,
    );

  if (
    !existing
  ) {
    throw new Error(
      `Notion task ${candidate.externalId} conflicted but could not be reloaded`,
    );
  }

  return {
    task:
      existing,
    inserted:
      false,
  };
}

/**
 * Maps durable local workflow state back to one supported Notion task status.
 */
function notionStatusForLocalState(
  status:
    Run["status"],
):
  | "In Progress"
  | "Done"
  | "Blocked"
  | "Failed" {
  if (
    status ===
    "completed"
  ) {
    return "Done";
  }

  if (
    status ===
    "blocked"
  ) {
    return "Blocked";
  }

  if (
    status ===
      "failed" ||
    status ===
      "cancelled"
  ) {
    return "Failed";
  }

  return "In Progress";
}

/**
 * Updates one persisted Notion task to In Progress and starts it only while the durable gate still allows intake.
 */
async function claimPersistedNotionTask(
  task:
    PersistedTask,
  adapter:
    AutoModeNotionAdapter,
  startExistingTask:
    StartExistingTask,
  canClaim:
    CanClaimTask,
): Promise<void> {
  if (
    !task.externalId
  ) {
    throw new Error(
      `Notion task ${task.id} is missing its external page id`,
    );
  }

  if (
    !await canClaim()
  ) {
    return;
  }

  await adapter.updateStatus(
    task.externalId,
    "In Progress",
  );

  if (
    !await canClaim()
  ) {
    return;
  }

  await startExistingTask(
    task.id,
  );
}

/**
 * Reconciles a duplicate Notion page identity against the existing local task instead of creating another task.
 */
async function reconcileExistingNotionTask(
  task:
    PersistedTask,
  adapter:
    AutoModeNotionAdapter,
  startExistingTask:
    StartExistingTask,
  canClaim:
    CanClaimTask,
  readEnabled:
    () => Promise<boolean>,
): Promise<void> {
  if (
    !task.externalId
  ) {
    throw new Error(
      `Notion task ${task.id} is missing its external page id`,
    );
  }

  const latestRun =
    await getLatestRunForTask(
      task.id,
    );

  if (
    task.status ===
      "pending" &&
    !latestRun
  ) {
    await claimPersistedNotionTask(
      task,
      adapter,
      startExistingTask,
      canClaim,
    );

    return;
  }

  if (
    !await readEnabled()
  ) {
    return;
  }

  await adapter.updateStatus(
    task.externalId,
    notionStatusForLocalState(
      latestRun?.status ??
        task.status,
    ),
  );
}

/**
 * Executes one Auto Mode intake cycle using PostgreSQL as the durable source of truth.
 */
export async function runAutoModeCycle(
  dependencies:
    AutoModeCycleDependencies = {},
): Promise<void> {
  const readSettings =
    dependencies.getSettings ??
    getSystemSettings;

  const evaluateEligibility =
    dependencies.evaluateEligibility ??
    evaluateAutoModeEligibility;

  const readEnabled =
    dependencies.isEnabled ??
    isAutoModeEnabled;

  const createAdapter =
    dependencies.createNotionAdapter ??
    createNotionTaskSourceAdapter;

  const startExistingTask =
    dependencies.startExistingTask ??
    startTask;

  /**
   * Rechecks the persisted switch and eligibility gate immediately before any remote claim or local start.
   */
  async function canClaim(): Promise<boolean> {
    if (
      !await readEnabled()
    ) {
      return false;
    }

    return (
      await evaluateEligibility()
    ).eligible;
  }

  const settings =
    await readSettings();

  if (
    !settings.autoModeEnabled
  ) {
    return;
  }

  const eligibility =
    await evaluateEligibility();

  if (
    !eligibility.eligible
  ) {
    return;
  }

  const recoverable =
    await findRecoverablePendingNotionTask();

  if (
    recoverable
  ) {
    if (
      !await canClaim()
    ) {
      return;
    }

    const adapter =
      createAdapter();

    await claimPersistedNotionTask(
      recoverable,
      adapter,
      startExistingTask,
      canClaim,
    );

    return;
  }

  if (
    !await canClaim()
  ) {
    return;
  }

  const adapter =
    createAdapter();

  const candidate =
    await adapter.getNextReadyTask();

  if (
    !candidate
  ) {
    return;
  }

  if (
    !await canClaim()
  ) {
    return;
  }

  const persisted =
    await persistNotionCandidate(
      candidate,
    );

  if (
    !persisted.inserted
  ) {
    await reconcileExistingNotionTask(
      persisted.task,
      adapter,
      startExistingTask,
      canClaim,
      readEnabled,
    );

    return;
  }

  await claimPersistedNotionTask(
    persisted.task,
    adapter,
    startExistingTask,
    canClaim,
  );
}
