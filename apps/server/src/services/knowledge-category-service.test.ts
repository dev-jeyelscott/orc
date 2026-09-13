import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agentSkills, agents, departments, knowledgeCategories, skills } from "../db/schema.js";
import {
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  getKnowledgeCategory,
  getKnowledgeCategoryFileContent,
  listKnowledgeCategories,
  listKnowledgeCategoryFiles,
  updateKnowledgeCategory,
  assertKnowledgeCategoryReadyForAnalysis,
} from "./knowledge-category-service.js";

const createdIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdSkillIds = new Set<string>();
const originalVaultRoot = process.env.KNOWLEDGE_VAULT_ROOT;
let vaultRoot: string;

const input = (label: string) => ({
  slug: `knowledge-${label}-${crypto.randomUUID()}`,
  name: `Knowledge ${label}`,
  description: "",
  vaultRootPath: `wiki/${label}`,
  enabled: true,
});

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "orc-knowledge-category-"));
  process.env.KNOWLEDGE_VAULT_ROOT = vaultRoot;
});

afterEach(async () => {
  for (const id of createdIds) {
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
  }
  createdIds.clear();

  for (const agentId of createdAgentIds) await db.delete(agents).where(eq(agents.id, agentId));
  for (const skillId of createdSkillIds) await db.delete(skills).where(eq(skills.id, skillId));
  for (const departmentId of createdDepartmentIds) await db.delete(departments).where(eq(departments.id, departmentId));
  createdAgentIds.clear(); createdSkillIds.clear(); createdDepartmentIds.clear();

  await rm(vaultRoot, { recursive: true, force: true });

  if (originalVaultRoot === undefined) {
    delete process.env.KNOWLEDGE_VAULT_ROOT;
  } else {
    process.env.KNOWLEDGE_VAULT_ROOT = originalVaultRoot;
  }
});

async function configuredSpecialist(options: { agentEnabled?: boolean; skillEnabled?: boolean } = {}) {
  const suffix = crypto.randomUUID();
  const [department] = await db.insert(departments).values({ slug: `knowledge-test-department-${suffix}`, name: "Knowledge Test Department", role: "specialist", harness: "codex", defaultModel: "default", defaultReasoning: "high", systemPrompt: "Test", canWrite: false, canRunCommands: false, canCommit: false }).returning();
  createdDepartmentIds.add(department.id);
  const [agent] = await db.insert(agents).values({ departmentId: department.id, slug: `knowledge-test-agent-${suffix}`, name: "Knowledge Test Agent", enabled: options.agentEnabled ?? true }).returning();
  createdAgentIds.add(agent.id);
  const [skill] = await db.insert(skills).values({ slug: `knowledge-test-skill-${suffix}`, name: "Knowledge Test Skill", enabled: options.skillEnabled ?? true }).returning();
  createdSkillIds.add(skill.id);
  await db.insert(agentSkills).values({ agentId: agent.id, skillId: skill.id });
  return { agent, skill };
}

describe("knowledge-category-service", () => {
  it("persists create, list, get, update, and deletion", async () => {
    const created = await createKnowledgeCategory(input("lifecycle"));
    createdIds.add(created.id);

    expect(created.enabled).toBe(true);
    expect((await getKnowledgeCategory(created.id))?.id).toBe(created.id);
    expect(
      (await listKnowledgeCategories()).some((item) => item.id === created.id),
    ).toBe(true);
    expect(
      (await updateKnowledgeCategory(created.id, { enabled: false }))?.enabled,
    ).toBe(false);
    expect(await deleteKnowledgeCategory(created.id)).toBe(true);
    createdIds.delete(created.id);
    expect(await getKnowledgeCategory(created.id)).toBeNull();
  });

  it("returns a stable conflict for duplicate slugs", async () => {
    const values = input("unique");
    const created = await createKnowledgeCategory(values);
    createdIds.add(created.id);

    await expect(
      createKnowledgeCategory({ ...values, name: "Another Category" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("browses vault files scoped to the category root", async () => {
    const category = await createKnowledgeCategory(input("uiux"));
    createdIds.add(category.id);

    const categoryDir = path.join(vaultRoot, category.vaultRootPath);
    await mkdir(categoryDir, { recursive: true });
    await writeFile(path.join(categoryDir, "_index.md"), "# Index\n");
    await writeFile(path.join(categoryDir, "forms.md"), "# Forms\n");

    const listing = await listKnowledgeCategoryFiles(category.id);
    expect(listing?.status).toBe("ok");
    expect(listing?.files).toEqual([
      { path: `${category.vaultRootPath}/_index.md`, name: "_index.md" },
      { path: `${category.vaultRootPath}/forms.md`, name: "forms.md" },
    ]);

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      `${category.vaultRootPath}/forms.md`,
    );
    expect(content).toEqual({
      status: "ok",
      path: `${category.vaultRootPath}/forms.md`,
      name: "forms.md",
      content: "# Forms\n",
    });
  });

  it("rejects a file preview path outside the category root", async () => {
    const category = await createKnowledgeCategory(input("scoped"));
    createdIds.add(category.id);

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      "wiki/other-category/secret.md",
    );

    expect(content).toEqual({
      status: "retrieval_error",
      message: "The requested vault file could not be read.",
    });
  });

  it("handles a nonexistent file safely", async () => {
    const category = await createKnowledgeCategory(input("missing"));
    createdIds.add(category.id);

    await mkdir(path.join(vaultRoot, category.vaultRootPath), {
      recursive: true,
    });

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      `${category.vaultRootPath}/missing.md`,
    );

    expect(content?.status).toBe("knowledge_unavailable");
  });

  it("reports knowledge_unavailable when the vault is not configured", async () => {
    delete process.env.KNOWLEDGE_VAULT_ROOT;

    const category = await createKnowledgeCategory(input("unavailable"));
    createdIds.add(category.id);

    const listing = await listKnowledgeCategoryFiles(category.id);
    expect(listing?.status).toBe("knowledge_unavailable");
  });

  it("returns null for an unknown category id", async () => {
    const unknownId = "00000000-0000-4000-9000-000000000099";

    expect(await listKnowledgeCategoryFiles(unknownId)).toBeNull();
    expect(
      await getKnowledgeCategoryFileContent(unknownId, "wiki/x/a.md"),
    ).toBeNull();
  });

  it("requires a configured specialist to own the category ingestion Skill", async () => {
    const { agent, skill } = await configuredSpecialist();
    const category = await createKnowledgeCategory({ ...input("assigned"), specialistAgentId: agent.id, ingestionSkillId: skill.id });
    createdIds.add(category.id);
    await expect(createKnowledgeCategory({ ...input("unassigned"), specialistAgentId: agent.id, ingestionSkillId: crypto.randomUUID() })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects disabled specialists and Skills at the reusable analysis-start gate", async () => {
    const disabledAgent = await configuredSpecialist({ agentEnabled: false });
    await expect(assertKnowledgeCategoryReadyForAnalysis({ specialistAgentId: disabledAgent.agent.id, ingestionSkillId: disabledAgent.skill.id })).rejects.toMatchObject({ statusCode: 400, message: "The selected specialist is not enabled for analysis" });
    const disabledSkill = await configuredSpecialist({ skillEnabled: false });
    await expect(assertKnowledgeCategoryReadyForAnalysis({ specialistAgentId: disabledSkill.agent.id, ingestionSkillId: disabledSkill.skill.id })).rejects.toMatchObject({ statusCode: 400, message: "The selected ingestion Skill is not enabled for analysis" });
  });
});
