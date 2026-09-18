import crypto from "node:crypto";

import { db } from "../db/client.js";
import { runAgentSkills, skillVersions } from "../db/schema.js";
import { loadConfigGraph, normalizeText } from "../config/loader.js";
import { env } from "../config/env.js";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Freezes one Run's assigned Skill scope per Agent from the canonical
 * `.orc/skills` tree at the moment the Run is created (roadmap Vertical Spec
 * 3, section 12.4). Only enabled Skills with loadable `SKILL.md` instructions
 * are frozen -- a disabled or metadata-only Skill is never searchable or
 * loadable for a Run, matching the same rule the live catalog enforces.
 *
 * Content is deduplicated by SHA-256 into `skill_versions` so many Runs/Agents
 * freezing an unchanged Skill body share one row. Safe to call with an empty
 * `agentSlugs` list (a no-op).
 */
export async function freezeRunAgentSkills(
  tx: DbOrTx,
  runId: string,
  agentAssignments: ReadonlyArray<{ agentId: string; agentSlug: string }>,
  configRoot: string = env.ORC_CONFIG_ROOT,
): Promise<void> {
  if (!agentAssignments.length) return;

  const graph = await loadConfigGraph(configRoot);
  const agentSlugs = new Set(agentAssignments.map((assignment) => assignment.agentSlug));
  const relevantSkillSlugs = new Set(
    graph.agents
      .filter((resource) => agentSlugs.has(resource.data.slug))
      .flatMap((resource) => resource.data.skills),
  );

  const loadableBySlug = new Map(
    graph.skills
      .filter(
        (resource) =>
          relevantSkillSlugs.has(resource.data.slug) &&
          resource.data.enabled &&
          typeof resource.instructions === "string" &&
          resource.instructions.trim().length > 0,
      )
      .map((resource) => [resource.data.slug, resource]),
  );

  if (!loadableBySlug.size) return;

  const contentHashBySlug = new Map<string, string>();
  const versionRows: Array<{ contentHash: string; content: string }> = [];

  for (const [slug, resource] of loadableBySlug) {
    const content = normalizeText(resource.instructions!);
    const contentHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    contentHashBySlug.set(slug, contentHash);
    versionRows.push({ contentHash, content });
  }

  for (const row of versionRows) {
    await tx.insert(skillVersions).values(row).onConflictDoNothing({ target: skillVersions.contentHash });
  }

  const assignmentRows = agentAssignments.flatMap(({ agentId, agentSlug }) => {
    const agentResource = graph.agents.find((resource) => resource.data.slug === agentSlug);
    if (!agentResource) return [];

    return agentResource.data.skills.flatMap((skillSlug) => {
      const resource = loadableBySlug.get(skillSlug);
      const contentHash = contentHashBySlug.get(skillSlug);
      if (!resource || !contentHash) return [];

      return [
        {
          runId,
          agentId,
          skillSlug,
          name: resource.data.name,
          description: resource.data.description,
          tags: resource.data.tags,
          domains: resource.data.domains,
          contentHash,
        },
      ];
    });
  });

  if (assignmentRows.length) {
    await tx.insert(runAgentSkills).values(assignmentRows);
  }
}
