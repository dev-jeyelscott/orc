import path from "node:path";

import { eq, isNull } from "drizzle-orm";

import { env } from "../config/env.js";
import { clearConfigOutOfSync, markConfigOutOfSync } from "../config/health-state.js";
import { loadConfigGraph, type ConfigGraph } from "../config/loader.js";
import {
  removeDepartmentProjection,
  removeSkillProjection,
  removeTeamProjection,
  retireAgentProjection,
  syncAgentProjection,
  syncAgentSkillAssignments,
  syncDepartmentProjection,
  syncProjectAssignmentProjection,
  syncSkillProjection,
  syncTeamMembershipProjection,
  syncTeamProjection,
} from "../config/projection-sync.js";
import { resolveWorkspaceRoot } from "../config/workspace-root.js";
import { db } from "../db/client.js";
import { agents, departments, projectTeamAssignments, skills, teams } from "../db/schema.js";
import { getProjectByPath } from "./project-discovery.js";
import { reconstructTeamWorkflowProjection } from "./workflow-graph-service.js";

export type ConfigSyncResult =
  | { status: "invalid"; errorCount: number }
  | {
      status: "synced";
      departmentCount: number;
      agentCount: number;
      skillCount: number;
      teamCount: number;
      projectCount: number;
    };

/** A removal candidate the operator must explicitly act on -- sync never deletes it automatically. */
export interface ConfigRemovalCandidate {
  resourceType: "department" | "agent" | "skill" | "team" | "project";
  slug: string;
}

/** In-flight sync promise, so concurrent callers await the same run instead of racing duplicate projections. */
let syncInFlight: Promise<ConfigSyncResult> | null = null;

/**
 * Synchronizes every PostgreSQL configuration projection from the current
 * `.orc/` graph (roadmap Vertical Spec 7). Refuses to run against an
 * invalid graph -- partial synchronization of a tree with known
 * cross-reference failures never happens. Upserts run in the roadmap's
 * documented dependency order and never delete a PostgreSQL row whose file
 * has simply gone missing (see `getConfigRemovalCandidates`); only an
 * explicit removal (department/agent/skill/team service deletes, or a
 * future explicit removal endpoint) does that.
 */
export async function synchronizeConfiguration(configRoot: string = env.ORC_CONFIG_ROOT): Promise<ConfigSyncResult> {
  if (syncInFlight) {
    return syncInFlight;
  }

  const run = performSync(configRoot);
  syncInFlight = run;

  try {
    return await run;
  } finally {
    syncInFlight = null;
  }
}

async function performSync(configRoot: string): Promise<ConfigSyncResult> {
  const graph = await loadConfigGraph(configRoot);

  if (!graph.valid) {
    return { status: "invalid", errorCount: graph.issues.length };
  }

  // Once the canonical graph is confirmed valid, any failure below -- DB
  // transaction, workflow reconstruction, anything -- must mark
  // configuration out-of-sync before rethrowing rather than letting a valid
  // `.orc/` graph combined with a failed projection be mistaken for "ready"
  // (roadmap invariant #4). Only a fully successful run below reaches
  // `clearConfigOutOfSync()`. This applies uniformly whether the failure is
  // triggered by startup, the explicit sync route/CLI, or a dashboard
  // mutation's own projection sync.
  try {
    await db.transaction(async (tx) => {
      for (const skill of graph.skills) {
        await syncSkillProjection(skill.data, skill.instructions, tx);
      }

      for (const department of graph.departments) {
        await syncDepartmentProjection(department.data, department.prompt, tx);
      }

      for (const agent of graph.agents) {
        const row = await syncAgentProjection(agent.data, agent.instructions, tx);
        await syncAgentSkillAssignments(row.id, agent.data.skills, tx);
      }

      for (const team of graph.teams) {
        await syncTeamProjection(team.data, tx);
      }

      for (const team of graph.teams) {
        const [row] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.slug, team.data.slug));
        if (row) {
          await syncTeamMembershipProjection(row.id, team.data.members, tx);
        }
      }

      const workspaceRoot = await resolveWorkspaceRoot(configRoot);

      for (const project of graph.projects) {
        const absolutePath = path.resolve(workspaceRoot, project.data.path);
        // A Project file never creates a Project by itself: a stale file for a
        // now-missing filesystem repository is left unprojected here, and
        // still surfaces as a removal candidate via `getConfigRemovalCandidates`.
        const discovered = await getProjectByPath(workspaceRoot, absolutePath);
        if (!discovered) continue;

        await syncProjectAssignmentProjection(project.data, absolutePath, tx);
      }
    });

    // Workflow Draft/Published reconstruction runs after the main transaction
    // commits: it needs the just-synced `agents`/`teams` rows to resolve
    // canonical slugs, and uses its own table lock per Team.
    for (const team of graph.teams) {
      const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, team.data.slug));
      if (row) {
        await reconstructTeamWorkflowProjection(row.id, configRoot);
      }
    }
  } catch (error) {
    markConfigOutOfSync({
      reason: "Configuration projection synchronization failed against a valid canonical graph",
      resourceType: "sync",
      resourceId: configRoot,
    });
    throw error;
  }

  clearConfigOutOfSync();

  return {
    status: "synced",
    departmentCount: graph.departments.length,
    agentCount: graph.agents.length,
    skillCount: graph.skills.length,
    teamCount: graph.teams.length,
    projectCount: graph.projects.length,
  };
}

/**
 * Reports PostgreSQL projection rows whose canonical file has gone missing
 * -- a removal candidate, never a blind delete (roadmap Vertical Spec 7,
 * section 16.6). The operator (or an explicit safe-delete call) decides
 * whether to actually remove the projection.
 */
export async function getConfigRemovalCandidates(configRoot: string = env.ORC_CONFIG_ROOT): Promise<ConfigRemovalCandidate[]> {
  const graph = await loadConfigGraph(configRoot);
  const candidates: ConfigRemovalCandidate[] = [];

  const [departmentRows, agentRows, skillRows, teamRows, assignmentRows] = await Promise.all([
    db.select({ slug: departments.slug }).from(departments),
    // Archived Agents are file-less by design; they are not removal candidates.
    db.select({ slug: agents.slug }).from(agents).where(isNull(agents.archivedAt)),
    db.select({ slug: skills.slug }).from(skills),
    db.select({ slug: teams.slug }).from(teams),
    db.select({ projectPath: projectTeamAssignments.projectPath }).from(projectTeamAssignments),
  ]);

  addMissingCandidates(candidates, "department", departmentRows.map((row) => row.slug), graph.departments.map((resource) => resource.data.slug));
  addMissingCandidates(candidates, "agent", agentRows.map((row) => row.slug), graph.agents.map((resource) => resource.data.slug));
  addMissingCandidates(candidates, "skill", skillRows.map((row) => row.slug), graph.skills.map((resource) => resource.data.slug));
  addMissingCandidates(candidates, "team", teamRows.map((row) => row.slug), graph.teams.map((resource) => resource.data.slug));

  if (assignmentRows.length) {
    const workspaceRoot = await resolveWorkspaceRoot(configRoot);
    const projectedPaths = new Set(graph.projects.map((resource) => path.resolve(workspaceRoot, resource.data.path)));
    for (const row of assignmentRows) {
      if (!projectedPaths.has(row.projectPath)) {
        candidates.push({ resourceType: "project", slug: path.basename(row.projectPath) });
      }
    }
  }

  return candidates;
}

function addMissingCandidates(
  candidates: ConfigRemovalCandidate[],
  resourceType: ConfigRemovalCandidate["resourceType"],
  projectedSlugs: readonly string[],
  fileSlugs: readonly string[],
): void {
  const fileSlugSet = new Set(fileSlugs);
  for (const slug of projectedSlugs) {
    if (!fileSlugSet.has(slug)) {
      candidates.push({ resourceType, slug });
    }
  }
}

/** Exported for tests that need the raw graph a sync run would act on. */
export async function previewSyncGraph(configRoot: string = env.ORC_CONFIG_ROOT): Promise<ConfigGraph> {
  return loadConfigGraph(configRoot);
}

/**
 * Removes explicitly-selected safe removal candidates' PostgreSQL projections.
 * Never removes a file. Agents still referenced by history are archived.
 */
export async function removeConfigProjections(candidates: readonly ConfigRemovalCandidate[]): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.resourceType === "department") await removeDepartmentProjection(candidate.slug);
    if (candidate.resourceType === "agent") await retireAgentProjection(candidate.slug);
    if (candidate.resourceType === "skill") await removeSkillProjection(candidate.slug);
    if (candidate.resourceType === "team") await removeTeamProjection(candidate.slug);
  }
}
