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
  type DepartmentResource,
} from "./loader.js";
import { agentConfigSchema, departmentConfigSchema, type AgentConfig, type DepartmentConfig } from "./schemas.js";

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
