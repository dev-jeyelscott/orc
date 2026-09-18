import { and, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { runAgentSkills, skillVersions } from "../db/schema.js";

/** Roadmap Vertical Spec 3, section 12.5: small default, bounded hard maximum. */
export const DEFAULT_SKILL_SEARCH_LIMIT = 5;
export const MAX_SKILL_SEARCH_LIMIT = 10;

export interface SkillSearchCandidate {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  domains: string[];
}

export interface LoadedSkill {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  domains: string[];
  contentHash: string;
  instructions: string;
}

type RunAgentSkillRow = typeof runAgentSkills.$inferSelect;

function toCandidate(row: RunAgentSkillRow): SkillSearchCandidate {
  return {
    slug: row.skillSlug,
    name: row.name,
    description: row.description,
    tags: (row.tags as string[] | null) ?? [],
    domains: (row.domains as string[] | null) ?? [],
  };
}

/** Loads every Skill frozen for one Run + Agent -- the only scope `search_skills`/`load_skill` may see. */
async function loadFrozenAssignedSkills(runId: string, agentId: string): Promise<RunAgentSkillRow[]> {
  return db
    .select()
    .from(runAgentSkills)
    .where(and(eq(runAgentSkills.runId, runId), eq(runAgentSkills.agentId, agentId)));
}

/**
 * Deterministic lexical/metadata ranking (roadmap section 12.6). No
 * embeddings, vector store, or LLM reranker: exact slug/name match ranks
 * highest, then a prefix match on name, then tag/domain match, then
 * description token overlap, with a stable slug tie-break so ranking never
 * depends on iteration/insertion order.
 */
function scoreCandidate(candidate: SkillSearchCandidate, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const name = candidate.name.toLowerCase();
  const slug = candidate.slug.toLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (slug === normalizedQuery || name === normalizedQuery) return 100;
  if (name.startsWith(normalizedQuery) || slug.startsWith(normalizedQuery)) return 80;
  if (candidate.tags.some((tag) => tag.toLowerCase() === normalizedQuery) || candidate.domains.some((domain) => domain.toLowerCase() === normalizedQuery)) {
    return 60;
  }

  const descriptionTokens = new Set(candidate.description.toLowerCase().split(/\s+/).filter(Boolean));
  const overlap = queryTokens.filter((token) => descriptionTokens.has(token)).length;
  if (overlap > 0) return 40 + overlap;

  return 0;
}

/**
 * Searches only the executing Agent's frozen assigned Skill scope for the
 * current Run using deterministic metadata ranking. Never escapes to the
 * live `.orc/skills` catalog or any other Agent/Run's assignments.
 */
export async function searchAssignedSkills(
  runId: string,
  agentId: string,
  query: string,
  limit: number = DEFAULT_SKILL_SEARCH_LIMIT,
): Promise<SkillSearchCandidate[]> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_SKILL_SEARCH_LIMIT));
  const rows = await loadFrozenAssignedSkills(runId, agentId);
  const candidates = rows.map(toCandidate);

  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, query) }))
    .filter((scored) => scored.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.slug.localeCompare(right.candidate.slug))
    .slice(0, boundedLimit)
    .map((scored) => scored.candidate);
}

/**
 * Loads one exact frozen Skill's full instructions for the current Run +
 * Agent. Returns null for a slug that was never assigned/frozen for this
 * Run + Agent scope -- callers must never fall back to the live catalog.
 */
export async function loadAssignedSkill(runId: string, agentId: string, slug: string): Promise<LoadedSkill | null> {
  const [row] = await db
    .select()
    .from(runAgentSkills)
    .innerJoin(skillVersions, eq(runAgentSkills.contentHash, skillVersions.contentHash))
    .where(and(eq(runAgentSkills.runId, runId), eq(runAgentSkills.agentId, agentId), eq(runAgentSkills.skillSlug, slug)));

  if (!row) return null;

  return {
    ...toCandidate(row.run_agent_skills),
    contentHash: row.run_agent_skills.contentHash,
    instructions: row.skill_versions.content,
  };
}
