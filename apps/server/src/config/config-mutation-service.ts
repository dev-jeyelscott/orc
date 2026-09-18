import fs from "node:fs/promises";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";

import {
  loadConfigGraph,
  normalizeText,
  sha256,
  validateReferenceGraph,
  validateUniqueSlugs,
  type AgentResource,
  type ConfigGraph,
  type ConfigIssue,
  type ConfigResource,
  type DepartmentResource,
  type SkillResource,
  type TeamResource,
} from "./loader.js";
import {
  agentConfigSchema,
  departmentConfigSchema,
  skillConfigSchema,
  teamConfigSchema,
  workflowConfigSchema,
  type AgentConfig,
  type DepartmentConfig,
  type SkillConfig,
  type TeamConfig,
  type WorkflowConfig,
} from "./schemas.js";

/** A save/delete arrived with a stale or missing expected `configRevision`. */
export class ConfigConflictError extends Error {
  readonly statusCode = 409;
}

/** A proposed canonical resource failed schema or cross-resource validation. */
export class ConfigValidationError extends Error {
  readonly statusCode = 400;
  constructor(readonly issues: ConfigIssue[]) {
    super(issues.map((issue) => issue.message).join(", ") || "Invalid configuration");
  }
}

/** A delete was refused because another canonical resource still references it. */
export class ConfigReferentialError extends Error {
  readonly statusCode = 409;
}

export interface WrittenDepartmentFile {
  data: DepartmentConfig;
  prompt: string;
  configRevision: string;
}

export interface WrittenAgentFile {
  data: AgentConfig;
  instructions: string;
  configRevision: string;
}

export interface WrittenSkillFile {
  data: SkillConfig;
  /** Null when the Skill remains metadata-only (no loadable `SKILL.md`). */
  instructions: string | null;
  configRevision: string;
}

export interface WrittenTeamFile {
  data: TeamConfig;
  configRevision: string;
}

export interface WrittenTeamWorkflowFile {
  data: WorkflowConfig;
  configRevision: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Writes content to a temp file in the destination's own directory, then renames atomically. */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

function runGraphValidation(graph: Omit<ConfigGraph, "issues" | "valid">): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  validateUniqueSlugs(graph.departments, "department", issues);
  validateUniqueSlugs(graph.agents, "agent", issues);
  validateUniqueSlugs(graph.skills, "skill", issues);
  validateUniqueSlugs(graph.teams, "team", issues);
  validateUniqueSlugs(graph.projects, "project", issues);
  validateReferenceGraph(graph, issues);
  return issues;
}

/** Loads the current graph and throws `ConfigValidationError` if it is already broken elsewhere. */
async function loadCleanGraph(configRoot: string): Promise<ConfigGraph> {
  const graph = await loadConfigGraph(configRoot);
  return graph;
}

/**
 * Writes one canonical Department resource following the mutation contract:
 * verify expected revision, validate the proposed resource in isolation,
 * validate the full cross-resource graph with the edit applied, then write
 * atomically. Handles a slug rename by moving the resource directory.
 *
 * `previousSlug` identifies the existing resource being edited when it may
 * differ from `data.slug` (a rename). Pass `null` for a new Department.
 */
export async function writeDepartmentFile(
  configRoot: string,
  data: DepartmentConfig,
  prompt: string,
  options: { previousSlug: string | null; expectedRevision: string | null },
): Promise<WrittenDepartmentFile> {
  const parsed = departmentConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        filePath: path.join(configRoot, "departments", data.slug, "department.yaml"),
        resourceType: "department",
        resourceId: data.slug,
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }

  const graph = await loadCleanGraph(configRoot);

  // `previousSlug` alone distinguishes create from update: `expectedRevision`
  // only controls whether an update's optimistic-lock check runs, it never
  // implies "must not already exist" (a caller that omits it is choosing to
  // skip conflict detection, not asking to create).
  let existing: DepartmentResource | null = null;
  if (options.previousSlug === null) {
    if (graph.departments.some((resource) => resource.data.slug === data.slug)) {
      throw new ConfigConflictError(`Department "${data.slug}" already exists`);
    }
  } else {
    existing = graph.departments.find((resource) => resource.data.slug === options.previousSlug) ?? null;
    if (!existing) {
      throw new ConfigConflictError(`Department "${options.previousSlug}" no longer exists`);
    }
    if (options.expectedRevision !== null && existing.contentHash !== options.expectedRevision) {
      throw new ConfigConflictError("Department was modified by another edit; reload and retry");
    }
  }

  const dir = path.join(configRoot, "departments", data.slug);
  if (!existing || existing.data.slug !== data.slug) {
    if (await pathExists(dir)) {
      throw new ConfigConflictError(`Department "${data.slug}" already exists`);
    }
  }

  const proposedResource: DepartmentResource = {
    filePath: path.join(dir, "department.yaml"),
    contentHash: "",
    data: parsed.data,
    prompt,
  };
  const proposedDepartments = existing
    ? graph.departments.map((resource) => (resource === existing ? proposedResource : resource))
    : [...graph.departments, proposedResource];

  const issues = runGraphValidation({ ...graph, departments: proposedDepartments });
  if (issues.length) {
    throw new ConfigValidationError(issues);
  }

  const previousDir = existing && existing.data.slug !== data.slug ? path.join(configRoot, "departments", existing.data.slug) : null;
  if (previousDir && (await pathExists(previousDir))) {
    await fs.rename(previousDir, dir);
  }

  const yamlContent = stringifyYaml(parsed.data);
  await atomicWriteFile(path.join(dir, "department.yaml"), yamlContent);
  await atomicWriteFile(path.join(dir, "prompt.md"), prompt);

  return { data: parsed.data, prompt, configRevision: sha256(normalizeText(yamlContent)) };
}

/**
 * Deletes one canonical Department resource. Refuses when any Agent file
 * still references it, so a safe removal never orphans an Agent's
 * Department reference.
 */
export async function deleteDepartmentFile(
  configRoot: string,
  slug: string,
  expectedRevision: string | null,
): Promise<boolean> {
  const graph = await loadCleanGraph(configRoot);
  const existing = graph.departments.find((resource) => resource.data.slug === slug);
  if (!existing) return false;

  if (expectedRevision !== null && existing.contentHash !== expectedRevision) {
    throw new ConfigConflictError("Department was modified by another edit; reload and retry");
  }

  const referencingAgent = graph.agents.find((resource) => resource.data.department === slug);
  if (referencingAgent) {
    throw new ConfigReferentialError(
      `Department "${slug}" cannot be deleted because Agent "${referencingAgent.data.slug}" still references it`,
    );
  }

  await fs.rm(path.join(configRoot, "departments", slug), { recursive: true, force: true });
  return true;
}

/**
 * Writes one canonical Agent resource. Requires the referenced Department
 * and every assigned Skill slug to already exist in the current graph.
 */
export async function writeAgentFile(
  configRoot: string,
  data: AgentConfig,
  instructions: string,
  options: { previousSlug: string | null; expectedRevision: string | null },
): Promise<WrittenAgentFile> {
  const parsed = agentConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        filePath: path.join(configRoot, "agents", data.slug, "agent.yaml"),
        resourceType: "agent",
        resourceId: data.slug,
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }

  const graph = await loadCleanGraph(configRoot);

  // See `writeDepartmentFile`: `previousSlug` decides create vs. update;
  // `expectedRevision` only gates the update's optimistic-lock check.
  let existing: AgentResource | null = null;
  if (options.previousSlug === null) {
    if (graph.agents.some((resource) => resource.data.slug === data.slug)) {
      throw new ConfigConflictError(`Agent "${data.slug}" already exists`);
    }
  } else {
    existing = graph.agents.find((resource) => resource.data.slug === options.previousSlug) ?? null;
    if (!existing) {
      throw new ConfigConflictError(`Agent "${options.previousSlug}" no longer exists`);
    }
    if (options.expectedRevision !== null && existing.contentHash !== options.expectedRevision) {
      throw new ConfigConflictError("Agent was modified by another edit; reload and retry");
    }
  }

  const dir = path.join(configRoot, "agents", data.slug);
  if (!existing || existing.data.slug !== data.slug) {
    if (await pathExists(dir)) {
      throw new ConfigConflictError(`Agent "${data.slug}" already exists`);
    }
  }

  const proposedResource: AgentResource = {
    filePath: path.join(dir, "agent.yaml"),
    contentHash: "",
    data: parsed.data,
    instructions,
  };
  const proposedAgents = existing
    ? graph.agents.map((resource) => (resource === existing ? proposedResource : resource))
    : [...graph.agents, proposedResource];

  const issues = runGraphValidation({ ...graph, agents: proposedAgents });
  if (issues.length) {
    throw new ConfigValidationError(issues);
  }

  const previousDir = existing && existing.data.slug !== data.slug ? path.join(configRoot, "agents", existing.data.slug) : null;
  if (previousDir && (await pathExists(previousDir))) {
    await fs.rename(previousDir, dir);
  }

  const yamlContent = stringifyYaml(parsed.data);
  await atomicWriteFile(path.join(dir, "agent.yaml"), yamlContent);
  await atomicWriteFile(path.join(dir, "instructions.md"), instructions);

  return { data: parsed.data, instructions, configRevision: sha256(normalizeText(yamlContent)) };
}

/**
 * Deletes one canonical Agent resource. Team membership safety is enforced
 * by the caller against the PostgreSQL `team_members` projection, which
 * remains the runtime source for membership until Team files become
 * authoritative (roadmap Vertical Spec 4).
 */
export async function deleteAgentFile(
  configRoot: string,
  slug: string,
  expectedRevision: string | null,
): Promise<boolean> {
  const graph = await loadCleanGraph(configRoot);
  const existing = graph.agents.find((resource) => resource.data.slug === slug);
  if (!existing) return false;

  if (expectedRevision !== null && existing.contentHash !== expectedRevision) {
    throw new ConfigConflictError("Agent was modified by another edit; reload and retry");
  }

  await fs.rm(path.join(configRoot, "agents", slug), { recursive: true, force: true });
  return true;
}

/**
 * Writes one canonical Skill resource. `instructions: null` keeps the Skill
 * metadata-only (no `SKILL.md` written); an empty or whitespace-only string
 * is treated the same way so a blank editor field never creates a
 * technically-non-null-but-useless file.
 */
export async function writeSkillFile(
  configRoot: string,
  data: SkillConfig,
  instructions: string | null,
  options: { previousSlug: string | null; expectedRevision: string | null },
): Promise<WrittenSkillFile> {
  const parsed = skillConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        filePath: path.join(configRoot, "skills", data.slug, "skill.yaml"),
        resourceType: "skill",
        resourceId: data.slug,
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }

  const graph = await loadCleanGraph(configRoot);

  let existing: SkillResource | null = null;
  if (options.previousSlug === null) {
    if (graph.skills.some((resource) => resource.data.slug === data.slug)) {
      throw new ConfigConflictError(`Skill "${data.slug}" already exists`);
    }
  } else {
    existing = graph.skills.find((resource) => resource.data.slug === options.previousSlug) ?? null;
    if (!existing) {
      throw new ConfigConflictError(`Skill "${options.previousSlug}" no longer exists`);
    }
    if (options.expectedRevision !== null && existing.contentHash !== options.expectedRevision) {
      throw new ConfigConflictError("Skill was modified by another edit; reload and retry");
    }
  }

  const dir = path.join(configRoot, "skills", data.slug);
  if (!existing || existing.data.slug !== data.slug) {
    if (await pathExists(dir)) {
      throw new ConfigConflictError(`Skill "${data.slug}" already exists`);
    }
  }

  const normalizedInstructions = instructions && instructions.trim() ? instructions : null;

  const proposedResource: SkillResource = {
    filePath: path.join(dir, "skill.yaml"),
    contentHash: "",
    data: parsed.data,
    instructions: normalizedInstructions,
  };
  const proposedSkills = existing
    ? graph.skills.map((resource) => (resource === existing ? proposedResource : resource))
    : [...graph.skills, proposedResource];

  const issues = runGraphValidation({ ...graph, skills: proposedSkills });
  if (issues.length) {
    throw new ConfigValidationError(issues);
  }

  const previousDir = existing && existing.data.slug !== data.slug ? path.join(configRoot, "skills", existing.data.slug) : null;
  if (previousDir && (await pathExists(previousDir))) {
    await fs.rename(previousDir, dir);
  }

  const yamlContent = stringifyYaml(parsed.data);
  await atomicWriteFile(path.join(dir, "skill.yaml"), yamlContent);

  const skillMdPath = path.join(dir, "SKILL.md");
  if (normalizedInstructions !== null) {
    await atomicWriteFile(skillMdPath, normalizedInstructions);
  } else if (await pathExists(skillMdPath)) {
    await fs.rm(skillMdPath, { force: true });
  }

  return { data: parsed.data, instructions: normalizedInstructions, configRevision: sha256(normalizeText(yamlContent)) };
}

/**
 * Deletes one canonical Skill resource. Refuses when any Agent file still
 * assigns it, so a safe removal never orphans an Agent's Skill reference.
 */
export async function deleteSkillFile(
  configRoot: string,
  slug: string,
  expectedRevision: string | null,
): Promise<boolean> {
  const graph = await loadCleanGraph(configRoot);
  const existing = graph.skills.find((resource) => resource.data.slug === slug);
  if (!existing) return false;

  if (expectedRevision !== null && existing.contentHash !== expectedRevision) {
    throw new ConfigConflictError("Skill was modified by another edit; reload and retry");
  }

  const referencingAgent = graph.agents.find((resource) => resource.data.skills.includes(slug));
  if (referencingAgent) {
    throw new ConfigReferentialError(
      `Skill "${slug}" cannot be deleted because Agent "${referencingAgent.data.slug}" still assigns it`,
    );
  }

  await fs.rm(path.join(configRoot, "skills", slug), { recursive: true, force: true });
  return true;
}

/** Reads one Skill's current canonical `configRevision`, or null if the file does not exist. */
export async function getSkillRevision(configRoot: string, slug: string): Promise<string | null> {
  const graph = await loadConfigGraph(configRoot);
  return graph.skills.find((resource) => resource.data.slug === slug)?.contentHash ?? null;
}

/**
 * Writes one canonical Team resource (metadata + membership; `workflow.yaml`
 * is a sibling file this function never touches -- a slug rename carries it
 * along by moving the whole directory). Membership slugs must already
 * reference existing Agent resources in the current graph; cross-Team
 * exclusivity and one-Agent-per-Department are enforced by the same
 * `validateReferenceGraph` pass the loader uses.
 */
export async function writeTeamFile(
  configRoot: string,
  data: TeamConfig,
  options: { previousSlug: string | null; expectedRevision: string | null },
): Promise<WrittenTeamFile> {
  const parsed = teamConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        filePath: path.join(configRoot, "teams", data.slug, "team.yaml"),
        resourceType: "team",
        resourceId: data.slug,
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }

  const graph = await loadCleanGraph(configRoot);

  // See `writeDepartmentFile`: `previousSlug` decides create vs. update;
  // `expectedRevision` only gates the update's optimistic-lock check.
  let existing: TeamResource | null = null;
  if (options.previousSlug === null) {
    if (graph.teams.some((resource) => resource.data.slug === data.slug)) {
      throw new ConfigConflictError(`Team "${data.slug}" already exists`);
    }
  } else {
    existing = graph.teams.find((resource) => resource.data.slug === options.previousSlug) ?? null;
    if (!existing) {
      throw new ConfigConflictError(`Team "${options.previousSlug}" no longer exists`);
    }
    if (options.expectedRevision !== null && existing.contentHash !== options.expectedRevision) {
      throw new ConfigConflictError("Team was modified by another edit; reload and retry");
    }
  }

  const dir = path.join(configRoot, "teams", data.slug);
  if (!existing || existing.data.slug !== data.slug) {
    if (await pathExists(dir)) {
      throw new ConfigConflictError(`Team "${data.slug}" already exists`);
    }
  }

  const proposedResource: TeamResource = {
    filePath: path.join(dir, "team.yaml"),
    contentHash: "",
    data: parsed.data,
    workflow: existing?.workflow ?? null,
  };
  const proposedTeams = existing
    ? graph.teams.map((resource) => (resource === existing ? proposedResource : resource))
    : [...graph.teams, proposedResource];

  const issues = runGraphValidation({ ...graph, teams: proposedTeams });
  if (issues.length) {
    throw new ConfigValidationError(issues);
  }

  const previousDir = existing && existing.data.slug !== data.slug ? path.join(configRoot, "teams", existing.data.slug) : null;
  if (previousDir && (await pathExists(previousDir))) {
    await fs.rename(previousDir, dir);
  }

  const yamlContent = stringifyYaml(parsed.data);
  await atomicWriteFile(path.join(dir, "team.yaml"), yamlContent);

  return { data: parsed.data, configRevision: sha256(normalizeText(yamlContent)) };
}

/**
 * Deletes one canonical Team resource (metadata, membership, and any
 * `workflow.yaml`). Refuses when a Project file still assigns this Team.
 */
export async function deleteTeamFile(
  configRoot: string,
  slug: string,
  expectedRevision: string | null,
): Promise<boolean> {
  const graph = await loadCleanGraph(configRoot);
  const existing = graph.teams.find((resource) => resource.data.slug === slug);
  if (!existing) return false;

  if (expectedRevision !== null && existing.contentHash !== expectedRevision) {
    throw new ConfigConflictError("Team was modified by another edit; reload and retry");
  }

  const referencingProject = graph.projects.find((resource) => resource.data.team === slug);
  if (referencingProject) {
    throw new ConfigReferentialError(
      `Team "${slug}" cannot be deleted because Project "${referencingProject.data.slug}" still references it`,
    );
  }

  await fs.rm(path.join(configRoot, "teams", slug), { recursive: true, force: true });
  return true;
}

/** Reads one Team's current canonical `configRevision`, or null if the file does not exist. */
export async function getTeamRevision(configRoot: string, slug: string): Promise<string | null> {
  const graph = await loadConfigGraph(configRoot);
  return graph.teams.find((resource) => resource.data.slug === slug)?.contentHash ?? null;
}

/**
 * Writes one Team's canonical `workflow.yaml` (Draft + Published state,
 * roadmap Vertical Spec 5). Requires the owning Team to already have a
 * canonical `team.yaml` -- a Team not yet migrated to file-authoritative
 * membership has no directory to place `workflow.yaml` in, and the caller
 * (`workflow-graph-service.ts`) falls back to DB-only Draft/Publish
 * behavior for that case rather than calling this function. Re-validates
 * the full graph so every Agent node key still resolves to a current Team
 * member.
 */
export async function writeTeamWorkflowFile(
  configRoot: string,
  teamSlug: string,
  data: WorkflowConfig,
  expectedRevision: string | null,
): Promise<WrittenTeamWorkflowFile> {
  const parsed = workflowConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => ({
        filePath: path.join(configRoot, "teams", teamSlug, "workflow.yaml"),
        resourceType: "workflow",
        resourceId: teamSlug,
        field: issue.path.join(".") || null,
        message: issue.message,
      })),
    );
  }

  const graph = await loadCleanGraph(configRoot);
  const teamIndex = graph.teams.findIndex((resource) => resource.data.slug === teamSlug);

  if (teamIndex === -1) {
    throw new ConfigConflictError(`Team "${teamSlug}" does not have a canonical file yet`);
  }

  const existingTeam = graph.teams[teamIndex];

  if (expectedRevision !== null && existingTeam.workflow && existingTeam.workflow.contentHash !== expectedRevision) {
    throw new ConfigConflictError("Workflow was modified by another edit; reload and retry");
  }

  const dir = path.join(configRoot, "teams", teamSlug);
  const proposedWorkflow: ConfigResource<WorkflowConfig> = {
    filePath: path.join(dir, "workflow.yaml"),
    contentHash: "",
    data: parsed.data,
  };
  const proposedTeams = graph.teams.map((resource, index) =>
    index === teamIndex ? { ...existingTeam, workflow: proposedWorkflow } : resource,
  );

  const issues = runGraphValidation({ ...graph, teams: proposedTeams });
  if (issues.length) {
    throw new ConfigValidationError(issues);
  }

  const yamlContent = stringifyYaml(parsed.data);
  await atomicWriteFile(path.join(dir, "workflow.yaml"), yamlContent);

  return { data: parsed.data, configRevision: sha256(normalizeText(yamlContent)) };
}

/** Reads one Team's current canonical workflow `configRevision`, or null if no `workflow.yaml` exists yet. */
export async function getTeamWorkflowRevision(configRoot: string, teamSlug: string): Promise<string | null> {
  const graph = await loadConfigGraph(configRoot);
  return graph.teams.find((resource) => resource.data.slug === teamSlug)?.workflow?.contentHash ?? null;
}

/** Reads one Department's current canonical `configRevision`, or null if the file does not exist. */
export async function getDepartmentRevision(configRoot: string, slug: string): Promise<string | null> {
  const graph = await loadConfigGraph(configRoot);
  return graph.departments.find((resource) => resource.data.slug === slug)?.contentHash ?? null;
}

/** Reads one Agent's current canonical `configRevision`, or null if the file does not exist. */
export async function getAgentRevision(configRoot: string, slug: string): Promise<string | null> {
  const graph = await loadConfigGraph(configRoot);
  return graph.agents.find((resource) => resource.data.slug === slug)?.contentHash ?? null;
}
