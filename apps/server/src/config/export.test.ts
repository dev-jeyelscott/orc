import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { agentSkills, agents, departments, skills } from "../db/schema.js";
import { ConfigExportError, exportConfigFromDatabase } from "./export.js";

const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdSkillIds = new Set<string>();
const createdOutputRoots: string[] = [];

afterEach(async () => {
  for (const id of createdAgentIds) await db.delete(agentSkills).where(eq(agentSkills.agentId, id));
  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  createdAgentIds.clear();
  for (const id of createdSkillIds) await db.delete(skills).where(eq(skills.id, id));
  createdSkillIds.clear();
  for (const id of createdDepartmentIds) await db.delete(departments).where(eq(departments.id, id));
  createdDepartmentIds.clear();
  for (const root of createdOutputRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("exportConfigFromDatabase", () => {
  it("exports UUID relationships as slugs and preserves prompt/instruction text exactly", async () => {
    const suffix = crypto.randomUUID();

    const [department] = await db
      .insert(departments)
      .values({
        slug: `export-dept-${suffix}`,
        name: "Export Department",
        role: "Engineer",
        harness: "codex",
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Exact system prompt content.\nSecond line.",
        canWrite: true,
        canRunCommands: true,
        canCommit: false,
      })
      .returning();
    createdDepartmentIds.add(department.id);

    const [skill] = await db
      .insert(skills)
      .values({ slug: `export-skill-${suffix}`, name: "Export Skill", description: "", enabled: true })
      .returning();
    createdSkillIds.add(skill.id);

    const [agent] = await db
      .insert(agents)
      .values({
        departmentId: department.id,
        slug: `export-agent-${suffix}`,
        name: "Export Agent",
        additionalPrompt: "Exact additional prompt.\nSecond line.",
      })
      .returning();
    createdAgentIds.add(agent.id);

    await db.insert(agentSkills).values({ agentId: agent.id, skillId: skill.id });

    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-export-test-"));
    createdOutputRoots.push(outputRoot);

    const result = await exportConfigFromDatabase({ outputRoot, workspaceRoot: env.WORKSPACE_ROOT });

    const departmentYamlPath = path.join(outputRoot, "departments", department.slug, "department.yaml");
    const departmentPromptPath = path.join(outputRoot, "departments", department.slug, "prompt.md");
    const agentYamlPath = path.join(outputRoot, "agents", agent.slug, "agent.yaml");
    const agentInstructionsPath = path.join(outputRoot, "agents", agent.slug, "instructions.md");

    expect(result.filesWritten).toContain(departmentYamlPath);

    const departmentYaml = parseYaml(await fs.readFile(departmentYamlPath, "utf8"));
    expect(departmentYaml.slug).toBe(department.slug);
    expect(departmentYaml.runtime.harness).toBe("codex");

    expect(await fs.readFile(departmentPromptPath, "utf8")).toBe("Exact system prompt content.\nSecond line.");

    const agentYaml = parseYaml(await fs.readFile(agentYamlPath, "utf8"));
    expect(agentYaml.department).toBe(department.slug);
    expect(agentYaml.skills).toEqual([skill.slug]);

    expect(await fs.readFile(agentInstructionsPath, "utf8")).toBe("Exact additional prompt.\nSecond line.");
  });

  it("refuses to silently overwrite an existing canonical file", async () => {
    const suffix = crypto.randomUUID();

    const [department] = await db
      .insert(departments)
      .values({
        slug: `export-overwrite-${suffix}`,
        name: "Overwrite Department",
        role: "Engineer",
        harness: "codex",
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Prompt.",
        canWrite: true,
        canRunCommands: true,
        canCommit: false,
      })
      .returning();
    createdDepartmentIds.add(department.id);

    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-export-test-"));
    createdOutputRoots.push(outputRoot);

    await exportConfigFromDatabase({ outputRoot, workspaceRoot: env.WORKSPACE_ROOT });

    await expect(exportConfigFromDatabase({ outputRoot, workspaceRoot: env.WORKSPACE_ROOT })).rejects.toBeInstanceOf(
      ConfigExportError,
    );
  });

  it("performs no database mutation", async () => {
    const suffix = crypto.randomUUID();
    const [department] = await db
      .insert(departments)
      .values({
        slug: `export-readonly-${suffix}`,
        name: "Readonly Department",
        role: "Engineer",
        harness: "codex",
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Prompt.",
        canWrite: true,
        canRunCommands: true,
        canCommit: false,
      })
      .returning();
    createdDepartmentIds.add(department.id);

    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-export-test-"));
    createdOutputRoots.push(outputRoot);

    const [beforeCount] = await db.select().from(departments).where(eq(departments.id, department.id));
    await exportConfigFromDatabase({ outputRoot, workspaceRoot: env.WORKSPACE_ROOT });
    const [afterRow] = await db.select().from(departments).where(eq(departments.id, department.id));

    expect(afterRow.updatedAt.getTime()).toBe(beforeCount.updatedAt.getTime());
  });
});
