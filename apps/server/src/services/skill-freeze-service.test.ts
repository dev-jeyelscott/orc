import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments, runAgentSkills, runs, skillVersions, skills } from "../db/schema.js";
import { RESOLUTION_TEAM_ID } from "../db/seed-ids.js";
import { createAgent } from "./agent-service.js";
import { createDepartment } from "./department-service.js";
import { createSkill, updateSkill } from "./skill-service.js";
import { replaceAgentSkills } from "./agent-service.js";
import { freezeRunAgentSkills } from "./skill-freeze-service.js";

const createdRoots: string[] = [];
const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdSkillIds = new Set<string>();
const createdRunIds = new Set<string>();

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-skill-freeze-test-"));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const runId of createdRunIds) await db.delete(runs).where(eq(runs.id, runId));
  createdRunIds.clear();
  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  createdAgentIds.clear();
  for (const id of createdDepartmentIds) await db.delete(departments).where(eq(departments.id, id));
  createdDepartmentIds.clear();
  for (const id of createdSkillIds) await db.delete(skills).where(eq(skills.id, id));
  createdSkillIds.clear();
  for (const root of createdRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("freezeRunAgentSkills", () => {
  it("freezes only enabled, loadable assigned Skills, content-addressed and immutable per Run", async () => {
    const root = await makeConfigRoot();
    const suffix = crypto.randomUUID();

    const department = await createDepartment(
      {
        slug: `eng-${suffix}`, name: "Engineering", role: "Engineer", harness: "codex",
        defaultModel: "default", defaultReasoning: "high", systemPrompt: "Engineer.",
        canWrite: true, canRunCommands: true, canCommit: false,
      },
      root,
    );
    createdDepartmentIds.add(department.id);

    const loadableSkill = await createSkill(
      { slug: `db-migrations-${suffix}`, name: "Database Migrations", description: "Safe schema changes.", enabled: true, tags: ["database"], domains: ["backend"] },
      root,
    );
    createdSkillIds.add(loadableSkill.id);
    // createSkill never writes SKILL.md; give it loadable instructions directly.
    await fs.writeFile(path.join(root, "skills", loadableSkill.slug, "SKILL.md"), "# Migrate safely\n\nAlways write a rollback.");

    const disabledSkill = await createSkill(
      { slug: `disabled-skill-${suffix}`, name: "Disabled Skill", description: "", enabled: false, tags: [], domains: [] },
      root,
    );
    createdSkillIds.add(disabledSkill.id);
    await fs.writeFile(path.join(root, "skills", disabledSkill.slug, "SKILL.md"), "Should never be frozen.");

    const metadataOnlySkill = await createSkill(
      { slug: `metadata-only-${suffix}`, name: "Metadata Only", description: "", enabled: true, tags: [], domains: [] },
      root,
    );
    createdSkillIds.add(metadataOnlySkill.id);

    const agent = await createAgent(
      { departmentId: department.id, slug: `backend-engineer-${suffix}`, name: "Backend Engineer", enabled: true, additionalPrompt: "" },
      root,
    );
    createdAgentIds.add(agent.id);

    await replaceAgentSkills(agent.id, [loadableSkill.id, disabledSkill.id, metadataOnlySkill.id], root);

    const [run] = await db.insert(runs).values({ projectPath: "/tmp/orc-skill-freeze-test", teamId: RESOLUTION_TEAM_ID }).returning();
    createdRunIds.add(run.id);

    await freezeRunAgentSkills(db, run.id, [{ agentId: agent.id, agentSlug: agent.slug }], root);

    const frozen = await db.select().from(runAgentSkills).where(eq(runAgentSkills.runId, run.id));
    expect(frozen.map((row) => row.skillSlug)).toEqual([loadableSkill.slug]);
    expect(frozen[0].name).toBe("Database Migrations");
    expect(frozen[0].tags).toEqual(["database"]);

    const [version] = await db.select().from(skillVersions).where(eq(skillVersions.contentHash, frozen[0].contentHash));
    expect(version.content).toContain("Always write a rollback");

    // Editing the Skill after freezing must never change the already-frozen Run row.
    await updateSkill(loadableSkill.id, { description: "Changed after freeze" }, null, root);
    await fs.writeFile(path.join(root, "skills", loadableSkill.slug, "SKILL.md"), "Completely different content.");

    const [stillFrozen] = await db.select().from(runAgentSkills).where(eq(runAgentSkills.runId, run.id));
    expect(stillFrozen.description).toBe("Safe schema changes.");
    const [stillVersion] = await db.select().from(skillVersions).where(eq(skillVersions.contentHash, stillFrozen.contentHash));
    expect(stillVersion.content).toContain("Always write a rollback");
  });
});
