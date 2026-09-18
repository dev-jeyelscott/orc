import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import {
  agentConfigSchema,
  departmentConfigSchema,
  orcRootConfigSchema,
  projectConfigSchema,
  skillConfigSchema,
  teamConfigSchema,
  workflowConfigSchema,
  type AgentConfig,
  type DepartmentConfig,
  type OrcRootConfig,
  type ProjectConfig,
  type SkillConfig,
  type TeamConfig,
  type WorkflowConfig,
} from "./schemas.js";

/** One validation failure, always tied to the canonical file it came from. */
export interface ConfigIssue {
  filePath: string;
  resourceType: string;
  resourceId: string | null;
  field: string | null;
  message: string;
}

export interface ConfigResource<T> {
  filePath: string;
  contentHash: string;
  data: T;
}

export interface DepartmentResource extends ConfigResource<DepartmentConfig> {
  prompt: string;
}

export interface AgentResource extends ConfigResource<AgentConfig> {
  instructions: string;
}

export interface SkillResource extends ConfigResource<SkillConfig> {
  /** Null when the Skill is currently metadata-only (no loadable SKILL.md). */
  instructions: string | null;
}

export interface TeamResource extends ConfigResource<TeamConfig> {
  workflow: ConfigResource<WorkflowConfig> | null;
}

export type ProjectResource = ConfigResource<ProjectConfig>;

/**
 * One immutable, fully parsed and cross-validated `.orc/` configuration
 * graph. `valid` is false whenever `issues` is non-empty; callers must never
 * treat a graph with issues as a partially usable projection source.
 */
export interface ConfigGraph {
  configRoot: string;
  root: ConfigResource<OrcRootConfig> | null;
  departments: DepartmentResource[];
  agents: AgentResource[];
  skills: SkillResource[];
  teams: TeamResource[];
  projects: ProjectResource[];
  issues: ConfigIssue[];
  valid: boolean;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Normalizes line endings so a resource's content hash is platform-stable. */
function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function listChildDirectories(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return normalizeText(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Parses and validates one YAML resource file, appending a structured issue
 * per Zod error rather than throwing, so the loader can keep collecting
 * issues across the whole tree.
 */
async function loadYamlResource<T>(
  filePath: string,
  resourceType: string,
  schema: z.ZodTypeAny,
  issues: ConfigIssue[],
): Promise<ConfigResource<T> | null> {
  let raw: string;

  try {
    raw = normalizeText(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    issues.push({
      filePath,
      resourceType,
      resourceId: null,
      field: null,
      message: `File could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  let parsedYaml: unknown;

  try {
    parsedYaml = parseYaml(raw);
  } catch (error) {
    issues.push({
      filePath,
      resourceType,
      resourceId: null,
      field: null,
      message: `Malformed YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  const result = schema.safeParse(parsedYaml);

  if (!result.success) {
    const resourceId =
      typeof parsedYaml === "object" && parsedYaml !== null && "slug" in parsedYaml
        ? String((parsedYaml as { slug?: unknown }).slug ?? "")
        : null;

    for (const issue of result.error.issues) {
      issues.push({
        filePath,
        resourceType,
        resourceId,
        field: issue.path.join(".") || null,
        message: issue.message,
      });
    }

    return null;
  }

  return { filePath, contentHash: sha256(raw), data: result.data as T };
}

/** Rejects any relative path segment that escapes its expected parent directory. */
function isPathContained(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function loadDepartments(configRoot: string, issues: ConfigIssue[]): Promise<DepartmentResource[]> {
  const departmentsRoot = path.join(configRoot, "departments");
  const resources: DepartmentResource[] = [];

  for (const dirName of await listChildDirectories(departmentsRoot)) {
    const dir = path.join(departmentsRoot, dirName);
    if (!isPathContained(departmentsRoot, dir)) continue;

    const filePath = path.join(dir, "department.yaml");
    const resource = await loadYamlResource<DepartmentConfig>(filePath, "department", departmentConfigSchema, issues);
    if (!resource) continue;

    if (resource.data.slug !== dirName) {
      issues.push({
        filePath,
        resourceType: "department",
        resourceId: resource.data.slug,
        field: "slug",
        message: `Department slug "${resource.data.slug}" must match its directory name "${dirName}"`,
      });
      continue;
    }

    const prompt = (await readOptionalFile(path.join(dir, "prompt.md"))) ?? "";
    resources.push({ ...resource, prompt });
  }

  return resources;
}

async function loadAgents(configRoot: string, issues: ConfigIssue[]): Promise<AgentResource[]> {
  const agentsRoot = path.join(configRoot, "agents");
  const resources: AgentResource[] = [];

  for (const dirName of await listChildDirectories(agentsRoot)) {
    const dir = path.join(agentsRoot, dirName);
    if (!isPathContained(agentsRoot, dir)) continue;

    const filePath = path.join(dir, "agent.yaml");
    const resource = await loadYamlResource<AgentConfig>(filePath, "agent", agentConfigSchema, issues);
    if (!resource) continue;

    if (resource.data.slug !== dirName) {
      issues.push({
        filePath,
        resourceType: "agent",
        resourceId: resource.data.slug,
        field: "slug",
        message: `Agent slug "${resource.data.slug}" must match its directory name "${dirName}"`,
      });
      continue;
    }

    const instructions = (await readOptionalFile(path.join(dir, "instructions.md"))) ?? "";
    resources.push({ ...resource, instructions });
  }

  return resources;
}

async function loadSkills(configRoot: string, issues: ConfigIssue[]): Promise<SkillResource[]> {
  const skillsRoot = path.join(configRoot, "skills");
  const resources: SkillResource[] = [];

  for (const dirName of await listChildDirectories(skillsRoot)) {
    const dir = path.join(skillsRoot, dirName);
    if (!isPathContained(skillsRoot, dir)) continue;

    const filePath = path.join(dir, "skill.yaml");
    const resource = await loadYamlResource<SkillConfig>(filePath, "skill", skillConfigSchema, issues);
    if (!resource) continue;

    if (resource.data.slug !== dirName) {
      issues.push({
        filePath,
        resourceType: "skill",
        resourceId: resource.data.slug,
        field: "slug",
        message: `Skill slug "${resource.data.slug}" must match its directory name "${dirName}"`,
      });
      continue;
    }

    const instructions = await readOptionalFile(path.join(dir, "SKILL.md"));
    resources.push({ ...resource, instructions });
  }

  return resources;
}

async function loadTeams(configRoot: string, issues: ConfigIssue[]): Promise<TeamResource[]> {
  const teamsRoot = path.join(configRoot, "teams");
  const resources: TeamResource[] = [];

  for (const dirName of await listChildDirectories(teamsRoot)) {
    const dir = path.join(teamsRoot, dirName);
    if (!isPathContained(teamsRoot, dir)) continue;

    const filePath = path.join(dir, "team.yaml");
    const resource = await loadYamlResource<TeamConfig>(filePath, "team", teamConfigSchema, issues);
    if (!resource) continue;

    if (resource.data.slug !== dirName) {
      issues.push({
        filePath,
        resourceType: "team",
        resourceId: resource.data.slug,
        field: "slug",
        message: `Team slug "${resource.data.slug}" must match its directory name "${dirName}"`,
      });
      continue;
    }

    const workflowPath = path.join(dir, "workflow.yaml");
    let workflow: ConfigResource<WorkflowConfig> | null = null;
    if (await pathExists(workflowPath)) {
      workflow = await loadYamlResource<WorkflowConfig>(workflowPath, "workflow", workflowConfigSchema, issues);
    }

    resources.push({ ...resource, workflow });
  }

  return resources;
}

async function loadProjects(configRoot: string, issues: ConfigIssue[]): Promise<ProjectResource[]> {
  const projectsRoot = path.join(configRoot, "projects");
  const resources: ProjectResource[] = [];

  if (!(await pathExists(projectsRoot))) {
    return resources;
  }

  const entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of fileNames) {
    const filePath = path.join(projectsRoot, fileName);
    if (!isPathContained(projectsRoot, filePath)) continue;

    const resource = await loadYamlResource<ProjectConfig>(filePath, "project", projectConfigSchema, issues);
    if (!resource) continue;

    const expectedFileName = `${resource.data.slug}.yaml`;
    if (fileName !== expectedFileName) {
      issues.push({
        filePath,
        resourceType: "project",
        resourceId: resource.data.slug,
        field: "slug",
        message: `Project slug "${resource.data.slug}" must match its file name "${expectedFileName}"`,
      });
      continue;
    }

    if (path.isAbsolute(resource.data.path) || resource.data.path.split(/[\\/]+/).includes("..")) {
      issues.push({
        filePath,
        resourceType: "project",
        resourceId: resource.data.slug,
        field: "path",
        message: "Project path must be workspace-relative and must not traverse outside the workspace root",
      });
      continue;
    }

    resources.push(resource);
  }

  return resources;
}

/** Cross-resource reference and uniqueness rules that no single file can validate alone. */
function validateReferenceGraph(graph: Omit<ConfigGraph, "issues" | "valid">, issues: ConfigIssue[]): void {
  const departmentSlugs = new Set(graph.departments.map((resource) => resource.data.slug));
  const skillSlugs = new Set(graph.skills.map((resource) => resource.data.slug));
  const agentSlugs = new Set(graph.agents.map((resource) => resource.data.slug));
  const teamSlugs = new Set(graph.teams.map((resource) => resource.data.slug));

  for (const agent of graph.agents) {
    if (!departmentSlugs.has(agent.data.department)) {
      issues.push({
        filePath: agent.filePath,
        resourceType: "agent",
        resourceId: agent.data.slug,
        field: "department",
        message: `Agent references unknown Department "${agent.data.department}"`,
      });
    }

    for (const skillSlug of agent.data.skills) {
      if (!skillSlugs.has(skillSlug)) {
        issues.push({
          filePath: agent.filePath,
          resourceType: "agent",
          resourceId: agent.data.slug,
          field: "skills",
          message: `Agent references unknown Skill "${skillSlug}"`,
        });
      }
    }
  }

  const agentTeamMembership = new Map<string, string>();

  for (const team of graph.teams) {
    const departmentsInTeam = new Set<string>();
    const membersInTeam = new Set<string>();

    for (const memberSlug of team.data.members) {
      if (membersInTeam.has(memberSlug)) {
        issues.push({
          filePath: team.filePath,
          resourceType: "team",
          resourceId: team.data.slug,
          field: "members",
          message: `Agent "${memberSlug}" is listed more than once in Team "${team.data.slug}"`,
        });
        continue;
      }
      membersInTeam.add(memberSlug);

      const agentResource = graph.agents.find((resource) => resource.data.slug === memberSlug);

      if (!agentResource) {
        issues.push({
          filePath: team.filePath,
          resourceType: "team",
          resourceId: team.data.slug,
          field: "members",
          message: `Team references unknown Agent "${memberSlug}"`,
        });
        continue;
      }

      const existingTeam = agentTeamMembership.get(memberSlug);
      if (existingTeam && existingTeam !== team.data.slug) {
        issues.push({
          filePath: team.filePath,
          resourceType: "team",
          resourceId: team.data.slug,
          field: "members",
          message: `Agent "${memberSlug}" belongs to more than one Team ("${existingTeam}" and "${team.data.slug}")`,
        });
      }
      agentTeamMembership.set(memberSlug, team.data.slug);

      if (departmentsInTeam.has(agentResource.data.department)) {
        issues.push({
          filePath: team.filePath,
          resourceType: "team",
          resourceId: team.data.slug,
          field: "members",
          message: `Team "${team.data.slug}" selects more than one Agent from Department "${agentResource.data.department}"`,
        });
      }
      departmentsInTeam.add(agentResource.data.department);
    }

    if (team.workflow) {
      validateWorkflowGraph(team, issues);
    }
  }

  for (const project of graph.projects) {
    if (!teamSlugs.has(project.data.team)) {
      issues.push({
        filePath: project.filePath,
        resourceType: "project",
        resourceId: project.data.slug,
        field: "team",
        message: `Project references unknown Team "${project.data.team}"`,
      });
    }
  }

  // Keep every slug set referenced so the compiler flags a dropped rule
  // instead of silently accepting an unused cross-reference set.
  void agentSlugs;
}

function validateWorkflowGraph(team: TeamResource, issues: ConfigIssue[]): void {
  const workflow = team.workflow;
  if (!workflow) return;

  const memberSlugs = new Set(team.data.members);

  const graphs: Array<{ label: "draft" | "published"; graph: WorkflowConfig["draft"] }> = [
    { label: "draft", graph: workflow.data.draft },
  ];
  if (workflow.data.published) {
    graphs.push({ label: "published", graph: workflow.data.published.graph });
  }

  for (const { label, graph } of graphs) {
    const keys = new Set<string>();

    for (const node of graph.nodes) {
      if (keys.has(node.key)) {
        issues.push({
          filePath: workflow.filePath,
          resourceType: "workflow",
          resourceId: team.data.slug,
          field: `${label}.nodes`,
          message: `Duplicate symbolic node key "${node.key}" in ${label} graph`,
        });
        continue;
      }
      keys.add(node.key);

      if (node.kind === "agent" && !memberSlugs.has(node.agent)) {
        issues.push({
          filePath: workflow.filePath,
          resourceType: "workflow",
          resourceId: team.data.slug,
          field: `${label}.nodes`,
          message: `Workflow node "${node.key}" references Agent "${node.agent}" which is not a member of Team "${team.data.slug}"`,
        });
      }
    }

    for (const edge of graph.edges) {
      if (!keys.has(edge.source)) {
        issues.push({
          filePath: workflow.filePath,
          resourceType: "workflow",
          resourceId: team.data.slug,
          field: `${label}.edges`,
          message: `Edge source "${edge.source}" does not match any node key in ${label} graph`,
        });
      }
      if (!keys.has(edge.target)) {
        issues.push({
          filePath: workflow.filePath,
          resourceType: "workflow",
          resourceId: team.data.slug,
          field: `${label}.edges`,
          message: `Edge target "${edge.target}" does not match any node key in ${label} graph`,
        });
      }
    }
  }
}

function validateUniqueSlugs<T extends { data: { slug: string }; filePath: string }>(
  resources: T[],
  resourceType: string,
  issues: ConfigIssue[],
): void {
  const seen = new Map<string, string>();

  for (const resource of resources) {
    const existingFilePath = seen.get(resource.data.slug);
    if (existingFilePath) {
      issues.push({
        filePath: resource.filePath,
        resourceType,
        resourceId: resource.data.slug,
        field: "slug",
        message: `Duplicate ${resourceType} slug "${resource.data.slug}" (also defined at ${existingFilePath})`,
      });
      continue;
    }
    seen.set(resource.data.slug, resource.filePath);
  }
}

/**
 * Discovers, reads, and fully validates the canonical `.orc/` configuration
 * tree rooted at `configRoot`. Never throws for expected configuration
 * problems -- every discoverable issue is collected into `issues` and the
 * returned graph reports `valid: false` rather than a partial result being
 * silently treated as usable.
 */
export async function loadConfigGraph(configRoot: string): Promise<ConfigGraph> {
  const issues: ConfigIssue[] = [];

  let root: ConfigResource<OrcRootConfig> | null = null;
  const rootFilePath = path.join(configRoot, "orc.yaml");
  if (await pathExists(rootFilePath)) {
    root = await loadYamlResource<OrcRootConfig>(rootFilePath, "root", orcRootConfigSchema, issues);
  }

  const [departments, agents, skills, teams, projects] = await Promise.all([
    loadDepartments(configRoot, issues),
    loadAgents(configRoot, issues),
    loadSkills(configRoot, issues),
    loadTeams(configRoot, issues),
    loadProjects(configRoot, issues),
  ]);

  validateUniqueSlugs(departments, "department", issues);
  validateUniqueSlugs(agents, "agent", issues);
  validateUniqueSlugs(skills, "skill", issues);
  validateUniqueSlugs(teams, "team", issues);
  validateUniqueSlugs(projects, "project", issues);

  validateReferenceGraph({ configRoot, root, departments, agents, skills, teams, projects }, issues);

  return {
    configRoot,
    root,
    departments,
    agents,
    skills,
    teams,
    projects,
    issues,
    valid: issues.length === 0,
  };
}
