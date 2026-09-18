import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments, runAgentSkills, runs, skillVersions } from "../db/schema.js";
import { RESOLUTION_TEAM_ID } from "../db/seed-ids.js";
import { loadAssignedSkill, searchAssignedSkills } from "./skill-discovery-service.js";

const createdRunIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdContentHashes = new Set<string>();

afterEach(async () => {
  for (const id of createdRunIds) await db.delete(runs).where(eq(runs.id, id));
  createdRunIds.clear();
  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  createdAgentIds.clear();
  for (const id of createdDepartmentIds) await db.delete(departments).where(eq(departments.id, id));
  createdDepartmentIds.clear();
  for (const hash of createdContentHashes) await db.delete(skillVersions).where(eq(skillVersions.contentHash, hash));
  createdContentHashes.clear();
});

async function makeAgent(): Promise<{ agentId: string; departmentId: string }> {
  const suffix = crypto.randomUUID();
  const [department] = await db
    .insert(departments)
    .values({
      slug: `dept-${suffix}`, name: "Department", role: "Engineer", harness: "codex",
      defaultModel: "default", defaultReasoning: "high", systemPrompt: "",
      canWrite: true, canRunCommands: true, canCommit: false,
    })
    .returning();
  createdDepartmentIds.add(department.id);

  const [agent] = await db
    .insert(agents)
    .values({ departmentId: department.id, slug: `agent-${suffix}`, name: "Agent" })
    .returning();
  createdAgentIds.add(agent.id);

  return { agentId: agent.id, departmentId: department.id };
}

async function makeRun(): Promise<string> {
  const [run] = await db.insert(runs).values({ projectPath: "/tmp/orc-skill-discovery-test", teamId: RESOLUTION_TEAM_ID }).returning();
  createdRunIds.add(run.id);
  return run.id;
}

async function freezeSkill(
  runId: string,
  agentId: string,
  overrides: { skillSlug: string; name: string; description?: string; tags?: string[]; domains?: string[]; content?: string },
): Promise<void> {
  const content = overrides.content ?? `Instructions for ${overrides.skillSlug}`;
  const contentHash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  createdContentHashes.add(contentHash);
  await db.insert(skillVersions).values({ contentHash, content }).onConflictDoNothing({ target: skillVersions.contentHash });
  await db.insert(runAgentSkills).values({
    runId,
    agentId,
    skillSlug: overrides.skillSlug,
    name: overrides.name,
    description: overrides.description ?? "",
    tags: overrides.tags ?? [],
    domains: overrides.domains ?? [],
    contentHash,
  });
}

describe("searchAssignedSkills", () => {
  it("ranks exact/prefix/tag/description matches deterministically and applies a stable tie-break", async () => {
    const { agentId } = await makeAgent();
    const runId = await makeRun();

    await freezeSkill(runId, agentId, { skillSlug: "database-migrations", name: "Database Migrations", tags: ["database"], description: "Safe schema rollout guidance" });
    await freezeSkill(runId, agentId, { skillSlug: "database-tuning", name: "Database Tuning", description: "Index and query tuning" });
    await freezeSkill(runId, agentId, { skillSlug: "unrelated-skill", name: "Unrelated", description: "Nothing to do with databases" });

    const results = await searchAssignedSkills(runId, agentId, "database");
    expect(results.map((result) => result.slug)).toEqual(["database-migrations", "database-tuning"]);
  });

  it("never returns another Agent's or another Run's frozen Skills", async () => {
    const { agentId: ownAgent } = await makeAgent();
    const { agentId: otherAgent } = await makeAgent();
    const runId = await makeRun();
    const otherRunId = await makeRun();

    await freezeSkill(runId, ownAgent, { skillSlug: "own-skill", name: "Own Skill", description: "" });
    await freezeSkill(runId, otherAgent, { skillSlug: "other-agent-skill", name: "Other Agent Skill", description: "" });
    await freezeSkill(otherRunId, ownAgent, { skillSlug: "other-run-skill", name: "Other Run Skill", description: "" });

    const results = await searchAssignedSkills(runId, ownAgent, "own");
    expect(results.map((result) => result.slug)).toEqual(["own-skill"]);
  });

  it("bounds the result count to the requested and hard-maximum limits", async () => {
    const { agentId } = await makeAgent();
    const runId = await makeRun();
    for (let index = 0; index < 12; index += 1) {
      await freezeSkill(runId, agentId, { skillSlug: `skill-${index}`, name: `Skill ${index}`, tags: ["shared"] });
    }

    expect(await searchAssignedSkills(runId, agentId, "shared", 3)).toHaveLength(3);
    expect(await searchAssignedSkills(runId, agentId, "shared", 999)).toHaveLength(10);
  });
});

describe("loadAssignedSkill", () => {
  it("loads the exact frozen instructions for an assigned Skill and rejects an unassigned one", async () => {
    const { agentId } = await makeAgent();
    const runId = await makeRun();
    await freezeSkill(runId, agentId, { skillSlug: "database-migrations", name: "Database Migrations", content: "# Migrate safely" });

    const loaded = await loadAssignedSkill(runId, agentId, "database-migrations");
    expect(loaded?.instructions).toBe("# Migrate safely");

    expect(await loadAssignedSkill(runId, agentId, "never-assigned")).toBeNull();
  });
});
