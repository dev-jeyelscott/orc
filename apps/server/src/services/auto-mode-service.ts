import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";

import type {
  AgentResultStatus,
  Run,
  TeamAutomationUnavailableReason,
  ProjectAutomationStatus,
} from "@orc/shared";

import {
  env,
} from "../config/env.js";
import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  agents,
  departments,
  runs,
  tasks,
  teamMembers,
} from "../db/schema.js";
import {
  createNotionTaskSourceAdapter,
  type NotionTaskCandidate,
  type NotionTaskSourceAdapter,
} from "./notion-task-source.js";
import {
  getTeam,
} from "./team-service.js";
import {
  getProjectTeamAssignmentByPath,
  listProjectTeamAssignments,
} from "./project-team-assignment-service.js";
import {
  getProjectByPath,
} from "./project-discovery.js";
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
      ProjectAutomationStatus["state"],
      | "off"
      | "unavailable"
    >;
  nextEligibleAt:
    Date | null;
};

export type TeamAutoModeEligibility =
  AutoModeEligibility & {
    blockedByActiveRun:
      boolean;
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

export type ProjectAutomationReadiness = {
  projectPath: string;
  teamId: string | null;
  notionDataSourceId: string | null;
  autoModeEnabled: boolean;
  ready: boolean;
  unavailableReason: TeamAutomationUnavailableReason;
};

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

  // An operator cancelled or skipped this Notion task intentionally. Neither
  // outcome requires an approval result, so let Auto Mode claim the next Ready
  // task instead of leaving the Team permanently behind the approval gate.
  if (
    snapshot.runStatus ===
      "cancelled" ||
    snapshot.runStatus ===
      "skipped"
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

type ActiveRunSnapshot =
  {
    runStatus:
      Run["status"];
    teamId:
      string;
  }
  | null;

/**
 * Finds any currently active workflow system-wide, the authoritative one-active-run-globally capacity gate.
 */
async function getActiveRunSnapshot(): Promise<ActiveRunSnapshot> {
  const [activeRun] =
    await db
      .select({
        status:
          runs.status,
        teamId:
          runs.teamId,
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
    teamId:
      activeRun.teamId,
  };
}

async function getMostRecentlyExecutedProjectTaskId(teamId: string, projectPath: string): Promise<string | null> {
  const [activity] = await db.select({ taskId: runs.taskId }).from(runs).innerJoin(tasks, eq(runs.taskId, tasks.id)).where(and(eq(runs.teamId, teamId), eq(tasks.projectPath, projectPath), isNotNull(runs.taskId))).orderBy(desc(runs.updatedAt), desc(runs.createdAt), desc(runs.id)).limit(1);
  return activity?.taskId ?? null;
}

/**
 * Loads the newest run belonging to one task, guarding that it still belongs to the expected Team.
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
 * Resolves automation intent from one Project assignment. The filesystem check
 * is deliberate: a persisted row can never resurrect a removed repository.
 */
export async function getProjectAutomationReadiness(projectPath: string): Promise<ProjectAutomationReadiness> {
  const assignment = await getProjectTeamAssignmentByPath(projectPath);
  if (!assignment) return { projectPath, teamId: null, notionDataSourceId: null, autoModeEnabled: false, ready: false, unavailableReason: "team_disabled" };

  const project = await getProjectByPath(env.WORKSPACE_ROOT, assignment.projectPath);
  if (!project) return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: assignment.notionDataSourceId, autoModeEnabled: assignment.autoModeEnabled, ready: false, unavailableReason: "team_disabled" };

  const team = await getTeam(assignment.teamId);
  if (!team || !team.enabled) return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: assignment.notionDataSourceId, autoModeEnabled: assignment.autoModeEnabled, ready: false, unavailableReason: "team_disabled" };
  if (!assignment.notionDataSourceId) return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: null, autoModeEnabled: assignment.autoModeEnabled, ready: false, unavailableReason: "missing_notion_data_source" };
  if (!env.NOTION_API_KEY) return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: assignment.notionDataSourceId, autoModeEnabled: assignment.autoModeEnabled, ready: false, unavailableReason: "missing_notion_api_key" };

  const [member] = await db.select({ id: teamMembers.id }).from(teamMembers).innerJoin(agents, eq(teamMembers.agentId, agents.id)).innerJoin(departments, eq(agents.departmentId, departments.id)).where(and(eq(teamMembers.teamId, assignment.teamId), eq(agents.enabled, true), eq(departments.enabled, true))).limit(1);
  if (!member) return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: assignment.notionDataSourceId, autoModeEnabled: assignment.autoModeEnabled, ready: false, unavailableReason: "no_enabled_agents" };

  return { projectPath: assignment.projectPath, teamId: assignment.teamId, notionDataSourceId: assignment.notionDataSourceId, autoModeEnabled: assignment.autoModeEnabled, ready: assignment.autoModeEnabled, unavailableReason: null };
}

/** Project-scoped history prevents a Team reused by several Projects from sharing an approval gate. */
export async function evaluateProjectAutoModeEligibility(projectPath: string, teamId: string, now: Date = new Date()): Promise<TeamAutoModeEligibility> {
  const activeRun = await getActiveRunSnapshot();
  if (activeRun) return { eligible: false, state: activeRun.teamId === teamId ? "running" : "ready", nextEligibleAt: null, blockedByActiveRun: true };
  const taskId = await getMostRecentlyExecutedProjectTaskId(teamId, projectPath);
  const latestRun = taskId ? await getLatestRunForTask(taskId, teamId) : null;
  const history = latestRun ? { runStatus: latestRun.status, latestExecution: await getLatestExecutionForRun(latestRun.id) } : null;
  return { ...resolveAutoModeEligibility(history, now, env.NOTION_POST_APPROVAL_DELAY_SECONDS), blockedByActiveRun: false };
}

/** Exposes only current Project-assignment automation state to API consumers. */
export async function getProjectAutomationStatuses(): Promise<ProjectAutomationStatus[]> {
  const assignments = await listProjectTeamAssignments();
  const statuses: Array<ProjectAutomationStatus | null> = await Promise.all(assignments.map(async (assignment) => {
    if (!await getProjectByPath(env.WORKSPACE_ROOT, assignment.projectPath)) {
      return null;
    }
    const readiness = await getProjectAutomationReadiness(assignment.projectPath);
    if (!readiness.teamId) return null;
    if (!assignment.autoModeEnabled) {
      return { projectPath: assignment.projectPath, teamId: assignment.teamId, autoModeEnabled: false, state: "off" as const, nextEligibleAt: null, blockedByActiveRun: false, unavailableReason: null };
    }
    if (!readiness.ready) {
      return { projectPath: assignment.projectPath, teamId: assignment.teamId, autoModeEnabled: true, state: "unavailable" as const, nextEligibleAt: null, blockedByActiveRun: false, unavailableReason: readiness.unavailableReason };
    }
    const eligibility = await evaluateProjectAutoModeEligibility(assignment.projectPath, assignment.teamId);
    return { projectPath: assignment.projectPath, teamId: assignment.teamId, autoModeEnabled: true, state: eligibility.state, nextEligibleAt: eligibility.nextEligibleAt?.toISOString() ?? null, blockedByActiveRun: eligibility.blockedByActiveRun, unavailableReason: null };
  }));
  return statuses.filter((status): status is ProjectAutomationStatus => status !== null);
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
 * Persists one validated Notion candidate under its winning Team before any remote claim update, and reports
 * whether this cycle inserted it and whether an existing conflicting row belongs to a different Team.
 */
async function persistNotionCandidate(
  teamId:
    string,
  candidate:
    NotionTaskCandidate,
): Promise<{
  task:
    PersistedTask;
  inserted:
    boolean;
  teamMismatch:
    boolean;
}> {
  const [inserted] =
    await db
      .insert(tasks)
      .values({
        teamId,
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
      teamMismatch:
        false,
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
    teamMismatch:
      existing.teamId !==
      teamId,
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
  | "Failed"
  | "Skipped" {
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
    "skipped"
  ) {
    return "Skipped";
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
      task.teamId,
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

type TeamCandidate = {
  teamId:
    string;
  candidate:
    NotionTaskCandidate;
  adapter:
    AutoModeNotionAdapter;
};

/**
 * Orders cross-Team Notion candidates by priority ASC (1 is highest), oldest Notion creation time ASC, then a deterministic
 * stable tie breaker of Team id ASC and Notion page id ASC.
 */
function compareCandidates(
  a:
    TeamCandidate,
  b:
    TeamCandidate,
): number {
  if (
    a.candidate.priority !==
    b.candidate.priority
  ) {
    return (
      a.candidate.priority -
      b.candidate.priority
    );
  }

  const timeDiff =
    Date.parse(
      a.candidate.createdTime,
    ) -
    Date.parse(
      b.candidate.createdTime,
    );

  if (
    timeDiff !== 0
  ) {
    return timeDiff;
  }

  if (
    a.teamId !==
    b.teamId
  ) {
    return a.teamId <
      b.teamId
      ? -1
      : 1;
  }

  return a.candidate.externalId <
    b.candidate.externalId
    ? -1
    : 1;
}

type ProjectCandidate = {
  teamId: string;
  projectPath: string;
  candidate: NotionTaskCandidate;
  adapter: AutoModeNotionAdapter;
};

/**
 * Test-only seam for the two effects that cannot run against a real Notion
 * workspace or start a real worker process in a focused harness test.
 * Production always uses the real Notion adapter and `startTask`.
 */
export type AutoModeCycleDependencies = {
  createNotionAdapter?: (
    notionDataSourceId: string,
  ) => AutoModeNotionAdapter | Promise<AutoModeNotionAdapter>;
  startExistingTask?: StartExistingTask;
};

/**
 * Executes one Auto Mode intake cycle strictly from current, filesystem-backed
 * Project assignments, selecting and claiming at most one Task.
 */
export async function runAutoModeCycle(
  dependencies: AutoModeCycleDependencies = {},
): Promise<void> {
  const createAdapter =
    dependencies.createNotionAdapter ??
    createNotionTaskSourceAdapter;
  const startExistingTask =
    dependencies.startExistingTask ??
    startTask;

  if (await getActiveRunSnapshot()) return;

  const assignments = await listProjectTeamAssignments();
  const ready = (await Promise.all(assignments.map(async (assignment) => ({ assignment, readiness: await getProjectAutomationReadiness(assignment.projectPath) })))).filter(({ readiness }) => readiness.ready && readiness.teamId && readiness.notionDataSourceId);
  if (!ready.length) return;

  const candidates = await Promise.all(ready.map(async ({ assignment }) => {
    const adapter = await createAdapter(assignment.notionDataSourceId!);
    const candidate = await adapter.getNextReadyTask();
    // A data source associated with Project A must never create work for B.
    if (!candidate || candidate.project.path !== assignment.projectPath) return null;
    return { teamId: assignment.teamId, projectPath: assignment.projectPath, candidate, adapter } satisfies ProjectCandidate;
  }));
  const winner = candidates.filter((candidate): candidate is ProjectCandidate => candidate !== null).sort(compareCandidates)[0];
  if (!winner) return;

  const canClaim = async (): Promise<boolean> => {
    const readiness = await getProjectAutomationReadiness(winner.projectPath);
    if (!readiness.ready || readiness.teamId !== winner.teamId) return false;
    return (await evaluateProjectAutoModeEligibility(winner.projectPath, winner.teamId)).eligible;
  };
  if (!await canClaim()) return;

  const persisted = await persistNotionCandidate(winner.teamId, winner.candidate);
  if (persisted.teamMismatch || persisted.task.projectPath !== winner.projectPath) {
    throw new Error(`Notion page ${winner.candidate.externalId} is already claimed by a different Project or Team.`);
  }
  if (!persisted.inserted) {
    await reconcileExistingNotionTask(persisted.task, winner.adapter, startExistingTask, canClaim, async () => (await getProjectAutomationReadiness(winner.projectPath)).ready);
    return;
  }
  await claimPersistedNotionTask(persisted.task, winner.adapter, startExistingTask, canClaim);
}
