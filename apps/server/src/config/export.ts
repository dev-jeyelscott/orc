import fs from "node:fs/promises";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";
import { asc } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  agents,
  agentSkills,
  departments,
  projectTeamAssignments,
  skills,
  teamMembers,
  teams,
} from "../db/schema.js";
import { getPublishedRevision, getWorkflowAggregate } from "../services/workflow-graph-service.js";
import { loadConfigGraph, type ConfigGraph } from "./loader.js";
import type { WorkflowEdgeConfig, WorkflowGraphConfig, WorkflowNodeConfig } from "./schemas.js";

export class ConfigExportError extends Error {}

interface PlannedFile {
  /** Absolute path this exporter will write. */
  filePath: string;
  content: string;
}

/** Kebab-cases an arbitrary label for use as a Project slug/filename. */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "project";
}

function departmentYaml(row: typeof departments.$inferSelect): string {
  return stringifyYaml({
    version: 1,
    slug: row.slug,
    name: row.name,
    role: row.role,
    description: row.description,
    enabled: row.enabled,
    runtime: {
      harness: row.harness,
      model: row.defaultModel,
      reasoning: row.defaultReasoning,
    },
    permissions: {
      write: row.canWrite,
      commands: row.canRunCommands,
      sandboxMode: row.sandboxMode ?? null,
      commit: row.canCommit,
    },
  });
}

function agentYaml(
  row: typeof agents.$inferSelect,
  departmentSlug: string,
  skillSlugs: string[],
): string {
  return stringifyYaml({
    version: 1,
    slug: row.slug,
    name: row.name,
    department: departmentSlug,
    enabled: row.enabled,
    runtime: {
      harness: row.harnessOverride ?? null,
      model: row.modelOverride ?? null,
      reasoning: row.reasoningOverride ?? null,
    },
    permissions: {
      write: row.canWriteOverride ?? null,
      commands: row.canRunCommandsOverride ?? null,
      sandboxMode: row.sandboxModeOverride ?? null,
      commit: row.canCommitOverride ?? null,
    },
    skills: skillSlugs,
  });
}

function skillYaml(row: typeof skills.$inferSelect): string {
  return stringifyYaml({
    version: 1,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    tags: [],
    domains: [],
  });
}

function teamYaml(row: typeof teams.$inferSelect, memberSlugs: string[]): string {
  return stringifyYaml({
    version: 1,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    members: memberSlugs,
  });
}

function nodeKey(node: { kind: string; agentId?: string | null; terminalAction?: string | null }, agentSlugById: Map<string, string>): string {
  if (node.kind === "start") return "start";
  if (node.kind === "terminal") return `terminal:${node.terminalAction}`;
  return `agent:${agentSlugById.get(node.agentId as string) ?? node.agentId}`;
}

/** Converts one DB-shaped workflow graph (UUID node/edge ids) into the symbolic-key canonical form. */
function toWorkflowGraphConfig(
  graph: { nodes: Array<{ id: string; kind: string; agentId?: string | null; terminalAction?: string | null; position: { x: number; y: number } }>; edges: Array<{ sourceNodeId: string; targetNodeId: string; outcome: string | null }> },
  agentSlugById: Map<string, string>,
): WorkflowGraphConfig {
  const keyByNodeId = new Map<string, string>();
  const nodes: WorkflowNodeConfig[] = graph.nodes.map((node) => {
    const key = nodeKey(node, agentSlugById);
    keyByNodeId.set(node.id, key);

    if (node.kind === "start") {
      return { key, kind: "start", position: node.position };
    }
    if (node.kind === "terminal") {
      return { key, kind: "terminal", action: node.terminalAction as "complete_run" | "fail_run" | "block_run", position: node.position };
    }
    return { key, kind: "agent", agent: agentSlugById.get(node.agentId as string) ?? (node.agentId as string), position: node.position };
  });

  const edges: WorkflowEdgeConfig[] = graph.edges.map((edge) => ({
    source: keyByNodeId.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    target: keyByNodeId.get(edge.targetNodeId) ?? edge.targetNodeId,
    ...(edge.outcome ? { outcome: edge.outcome as WorkflowEdgeConfig["outcome"] } : {}),
  }));

  return { nodes, edges };
}

function projectYaml(slug: string, relativePath: string, resolutionTeam: string | null, developmentTeam: string | null, notionDataSourceId: string | null, autoModeEnabled: boolean, autoModeTeam: string | null): string {
  return stringifyYaml({
    version: 1,
    slug,
    path: relativePath,
    resolutionTeam,
    developmentTeam,
    automation: {
      notionDataSourceId,
      autoModeEnabled,
      autoModeTeam,
    },
  });
}

export interface ExportOptions {
  outputRoot: string;
  workspaceRoot: string;
}

export interface ExportResult {
  outputRoot: string;
  filesWritten: string[];
  validation: ConfigGraph;
}

/**
 * Reads the current PostgreSQL configuration and generates the equivalent
 * `.orc/` tree at `outputRoot`. Refuses to silently overwrite any existing
 * canonical file and validates the exported tree before reporting success.
 * Performs no PostgreSQL mutation.
 */
export async function exportConfigFromDatabase(options: ExportOptions): Promise<ExportResult> {
  const { outputRoot, workspaceRoot } = options;

  const [departmentRows, agentRows, skillRows, agentSkillRows, teamRows, teamMemberRows, assignmentRows] =
    await Promise.all([
      db.select().from(departments).orderBy(asc(departments.slug)),
      db.select().from(agents).orderBy(asc(agents.slug)),
      db.select().from(skills).orderBy(asc(skills.slug)),
      db.select().from(agentSkills),
      db.select().from(teams).orderBy(asc(teams.slug)),
      db.select().from(teamMembers),
      db.select().from(projectTeamAssignments),
    ]);

  const departmentSlugById = new Map(departmentRows.map((row) => [row.id, row.slug]));
  const agentSlugById = new Map(agentRows.map((row) => [row.id, row.slug]));
  const teamSlugById = new Map(teamRows.map((row) => [row.id, row.slug]));

  const skillSlugsByAgentId = new Map<string, string[]>();
  const skillById = new Map(skillRows.map((row) => [row.id, row]));
  for (const assignment of agentSkillRows) {
    const skillSlug = skillById.get(assignment.skillId)?.slug;
    if (!skillSlug) continue;
    const list = skillSlugsByAgentId.get(assignment.agentId) ?? [];
    list.push(skillSlug);
    skillSlugsByAgentId.set(assignment.agentId, list);
  }
  for (const list of skillSlugsByAgentId.values()) list.sort();

  const memberSlugsByTeamId = new Map<string, string[]>();
  for (const member of teamMemberRows) {
    const agentSlug = agentSlugById.get(member.agentId);
    if (!agentSlug) continue;
    const list = memberSlugsByTeamId.get(member.teamId) ?? [];
    list.push(agentSlug);
    memberSlugsByTeamId.set(member.teamId, list);
  }

  const plannedFiles: PlannedFile[] = [];

  for (const department of departmentRows) {
    const dir = path.join(outputRoot, "departments", department.slug);
    plannedFiles.push({ filePath: path.join(dir, "department.yaml"), content: departmentYaml(department) });
    plannedFiles.push({ filePath: path.join(dir, "prompt.md"), content: department.systemPrompt });
  }

  for (const agent of agentRows) {
    const departmentSlug = departmentSlugById.get(agent.departmentId);
    if (!departmentSlug) {
      throw new ConfigExportError(`Agent "${agent.slug}" references a Department that no longer exists`);
    }
    const dir = path.join(outputRoot, "agents", agent.slug);
    plannedFiles.push({
      filePath: path.join(dir, "agent.yaml"),
      content: agentYaml(agent, departmentSlug, skillSlugsByAgentId.get(agent.id) ?? []),
    });
    plannedFiles.push({ filePath: path.join(dir, "instructions.md"), content: agent.additionalPrompt });
  }

  for (const skill of skillRows) {
    const dir = path.join(outputRoot, "skills", skill.slug);
    plannedFiles.push({ filePath: path.join(dir, "skill.yaml"), content: skillYaml(skill) });
  }

  for (const team of teamRows) {
    const dir = path.join(outputRoot, "teams", team.slug);
    plannedFiles.push({
      filePath: path.join(dir, "team.yaml"),
      content: teamYaml(team, (memberSlugsByTeamId.get(team.id) ?? []).sort()),
    });

    const aggregate = await getWorkflowAggregate(team.id);
    if (aggregate) {
      const draft = toWorkflowGraphConfig(aggregate.draft.graph, agentSlugById);
      let published: { version: number; graph: WorkflowGraphConfig } | null = null;
      if (aggregate.published) {
        const revision = await getPublishedRevision(team.id, aggregate.published.id);
        published = {
          version: aggregate.published.version,
          graph: toWorkflowGraphConfig(revision ? revision.graph : { nodes: [], edges: [] }, agentSlugById),
        };
      }

      plannedFiles.push({
        filePath: path.join(dir, "workflow.yaml"),
        content: stringifyYaml({ version: 1, published, draft }),
      });
    }
  }

  for (const assignment of assignmentRows) {
    const resolutionTeam = assignment.resolutionTeamId ? teamSlugById.get(assignment.resolutionTeamId) ?? null : null;
    const developmentTeam = assignment.developmentTeamId ? teamSlugById.get(assignment.developmentTeamId) ?? null : null;
    const autoModeTeam = assignment.autoModeTeamId ? teamSlugById.get(assignment.autoModeTeamId) ?? null : null;
    if ((assignment.resolutionTeamId && !resolutionTeam) || (assignment.developmentTeamId && !developmentTeam) || (assignment.autoModeTeamId && !autoModeTeam)) {
      throw new ConfigExportError(`Project assignment for "${assignment.projectPath}" references a Team that no longer exists`);
    }

    const relativePath = path.relative(workspaceRoot, assignment.projectPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new ConfigExportError(
        `Project "${assignment.projectPath}" is outside the configured workspace root and cannot be exported as a portable path`,
      );
    }

    const slug = slugify(path.basename(assignment.projectPath));
    plannedFiles.push({
      filePath: path.join(outputRoot, "projects", `${slug}.yaml`),
      content: projectYaml(slug, relativePath, resolutionTeam, developmentTeam, assignment.notionDataSourceId, assignment.autoModeEnabled, autoModeTeam),
    });
  }

  // `orc.yaml.workspaceRoot` resolves relative to the app root (`outputRoot`'s
  // parent directory), never `.orc/` itself, matching `resolveWorkspaceRoot()`
  // (roadmap Vertical Spec 6, section 5.1). `path.relative(outputRoot, ...)`
  // would be one directory level too shallow.
  plannedFiles.push({
    filePath: path.join(outputRoot, "orc.yaml"),
    content: stringifyYaml({ version: 1, workspaceRoot: path.relative(path.dirname(outputRoot), workspaceRoot) || "." }),
  });

  for (const file of plannedFiles) {
    try {
      await fs.access(file.filePath);
      throw new ConfigExportError(`Refusing to overwrite existing canonical file: ${file.filePath}`);
    } catch (error) {
      if (error instanceof ConfigExportError) throw error;
      // ENOENT is expected: the file does not exist yet, which is required for export.
    }
  }

  for (const file of plannedFiles) {
    await fs.mkdir(path.dirname(file.filePath), { recursive: true });
    await fs.writeFile(file.filePath, file.content, "utf8");
  }

  const validation = await loadConfigGraph(outputRoot);

  return {
    outputRoot,
    filesWritten: plannedFiles.map((file) => file.filePath),
    validation,
  };
}
