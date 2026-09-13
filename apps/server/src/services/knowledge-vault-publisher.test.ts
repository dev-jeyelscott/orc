import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { db } = await import("../db/client.js");
const {
  agentSkills,
  agents,
  departments,
  knowledgeCategories,
  knowledgeIngestionBatches,
  knowledgeProposals,
  skills,
} = await import("../db/schema.js");
const { createKnowledgeCategory } = await import("./knowledge-category-service.js");
const { KnowledgeIngestionServiceError } = await import("./knowledge-ingestion-service.js");
const { submitIngestionBatch } = await import("./knowledge-vault-publisher.js");

const createdCategoryIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdSkillIds = new Set<string>();
const originalVaultRoot = process.env.KNOWLEDGE_VAULT_ROOT;
let vaultRoot: string;
let categoryDirName: string;

function git(args: string[]): string {
  return execFileSync("git", ["-C", vaultRoot, ...args], { encoding: "utf8" }).trim();
}

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "orc-knowledge-publish-"));
  process.env.KNOWLEDGE_VAULT_ROOT = vaultRoot;
  categoryDirName = `wiki/publish-${Math.random().toString(36).slice(2)}`;

  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  await mkdir(path.join(vaultRoot, categoryDirName), { recursive: true });
  await writeFile(path.join(vaultRoot, "README.md"), "# Vault\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);
});

afterEach(async () => {
  for (const id of createdCategoryIds) {
    await db.delete(knowledgeProposals).where(eq(knowledgeProposals.batchId, id));
    await db.delete(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.knowledgeCategoryId, id));
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
  }
  createdCategoryIds.clear();

  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  for (const id of createdSkillIds) await db.delete(skills).where(eq(skills.id, id));
  for (const id of createdDepartmentIds) await db.delete(departments).where(eq(departments.id, id));
  createdAgentIds.clear();
  createdSkillIds.clear();
  createdDepartmentIds.clear();

  await rm(vaultRoot, { recursive: true, force: true });

  if (originalVaultRoot === undefined) {
    delete process.env.KNOWLEDGE_VAULT_ROOT;
  } else {
    process.env.KNOWLEDGE_VAULT_ROOT = originalVaultRoot;
  }
});

async function configuredCategory() {
  const suffix = crypto.randomUUID();

  const [department] = await db
    .insert(departments)
    .values({
      slug: `knowledge-publish-department-${suffix}`,
      name: "Knowledge Publish Department",
      role: "specialist",
      harness: "codex",
      defaultModel: "default",
      defaultReasoning: "high",
      systemPrompt: "You are a Knowledge ingestion specialist.",
      canWrite: true,
      canRunCommands: true,
      canCommit: true,
    })
    .returning();
  createdDepartmentIds.add(department.id);

  const [agent] = await db
    .insert(agents)
    .values({ departmentId: department.id, slug: `knowledge-publish-agent-${suffix}`, name: "Publish Specialist", enabled: true })
    .returning();
  createdAgentIds.add(agent.id);

  const [skill] = await db
    .insert(skills)
    .values({ slug: `knowledge-publish-skill-${suffix}`, name: "Publish Skill", enabled: true })
    .returning();
  createdSkillIds.add(skill.id);

  await db.insert(agentSkills).values({ agentId: agent.id, skillId: skill.id });

  const category = await createKnowledgeCategory({
    slug: `knowledge-publish-${suffix}`,
    name: "Publish Category",
    description: "Category used to test vault publishing.",
    vaultRootPath: categoryDirName,
    enabled: true,
    specialistAgentId: agent.id,
    ingestionSkillId: skill.id,
  });
  createdCategoryIds.add(category.id);

  return { category, agent };
}

async function insertBatch(categoryId: string, specialistAgentId: string, overrides: Record<string, unknown> = {}) {
  const [batch] = await db
    .insert(knowledgeIngestionBatches)
    .values({
      knowledgeCategoryId: categoryId,
      specialistAgentId,
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n",
      sourceContentHash: "a".repeat(64),
      baseVaultCommitSha: git(["rev-parse", "HEAD"]),
      status: "review_ready",
      ...overrides,
    })
    .returning();

  return batch;
}

async function insertProposal(batchId: string, overrides: Record<string, unknown>) {
  const [proposal] = await db
    .insert(knowledgeProposals)
    .values({
      batchId,
      operation: "CREATE",
      targetPath: `${categoryDirName}/new.md`,
      confidenceScore: 0.9,
      confidenceLevel: "high",
      title: "New note",
      rationale: "Covers a gap.",
      evidence: [],
      proposedContent: "# New note\n\nBody.\n",
      reviewStatus: "approved",
      ...overrides,
    })
    .returning();

  return proposal;
}

describe("knowledge-vault-publisher", () => {
  it("applies only approved proposals and creates exactly one Git commit", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);

    const approved = await insertProposal(batch.id, {
      targetPath: `${categoryDirName}/forms.md`,
      title: "Forms guidance",
      proposedContent: "# Forms\n\nUse explicit labels.\n",
      reviewStatus: "approved",
    });
    const denied = await insertProposal(batch.id, {
      targetPath: `${categoryDirName}/tables.md`,
      title: "Tables guidance",
      proposedContent: "# Tables\n",
      reviewStatus: "denied",
    });
    const noChange = await insertProposal(batch.id, {
      operation: "NO_CHANGE",
      targetPath: `${categoryDirName}/existing.md`,
      title: "Already covered",
      proposedContent: "# Already covered\n",
      reviewStatus: "pending",
    });

    const headBefore = git(["rev-parse", "HEAD"]);

    const result = await submitIngestionBatch(batch.id);

    expect(result.appliedCount).toBe(1);
    expect(result.deniedCount).toBe(1);
    expect(result.noChangeCount).toBe(1);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.batch.status).toBe("committed");

    const headAfter = git(["rev-parse", "HEAD"]);
    expect(headAfter).not.toBe(headBefore);

    const log = git(["log", "--oneline"]);
    expect(log.split("\n")).toHaveLength(2);

    const written = await readFile(path.join(vaultRoot, categoryDirName, "forms.md"), "utf8");
    expect(written).toBe("# Forms\n\nUse explicit labels.\n");

    await expect(readFile(path.join(vaultRoot, categoryDirName, "tables.md"), "utf8")).rejects.toThrow();

    const index = await readFile(path.join(vaultRoot, categoryDirName, "_index.md"), "utf8");
    expect(index).toContain("forms.md");

    const logMd = await readFile(path.join(vaultRoot, categoryDirName, "log.md"), "utf8");
    expect(logMd).toContain(batch.id);

    const [refreshedApproved] = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.id, approved.id));
    expect(refreshedApproved.appliedAt).not.toBeNull();

    const [refreshedDenied] = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.id, denied.id));
    expect(refreshedDenied.appliedAt).toBeNull();

    const [refreshedNoChange] = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.id, noChange.id));
    expect(refreshedNoChange.appliedAt).toBeNull();
  });

  it("rejects submission when a proposal is still pending", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);
    await insertProposal(batch.id, { reviewStatus: "pending" });

    await expect(submitIngestionBatch(batch.id)).rejects.toMatchObject({ statusCode: 409 });

    const [refreshed] = await db.select().from(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.id, batch.id));
    expect(refreshed.status).toBe("review_ready");
  });

  it("rejects a stale target whose content changed since analysis without touching the vault", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);

    const originalContent = "# Drifted\n\nOriginal.\n";
    await writeFile(path.join(vaultRoot, categoryDirName, "drifted.md"), originalContent);
    git(["add", "."]);
    git(["commit", "-m", "seed drifted note"]);
    const originalHash = sha256(originalContent);

    // Concurrent edit after the specialist snapshotted existingContentHash.
    await writeFile(path.join(vaultRoot, categoryDirName, "drifted.md"), "# Drifted\n\nEdited concurrently.\n");
    git(["add", "."]);
    git(["commit", "-m", "concurrent edit"]);

    await insertProposal(batch.id, {
      operation: "UPDATE",
      targetPath: `${categoryDirName}/drifted.md`,
      existingContentHash: originalHash,
      proposedContent: "# Drifted\n\nSpecialist rewrite.\n",
      reviewStatus: "approved",
    });

    const headBefore = git(["rev-parse", "HEAD"]);

    await expect(submitIngestionBatch(batch.id)).rejects.toMatchObject({ statusCode: 409 });

    expect(git(["rev-parse", "HEAD"])).toBe(headBefore);
    const status = git(["status", "--porcelain"]);
    expect(status).toBe("");

    const [refreshed] = await db.select().from(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.id, batch.id));
    expect(refreshed.status).toBe("failed");
    expect(refreshed.failureReason).toMatch(/changed since analysis/i);
  });

  it("rejects a CREATE proposal whose target was concurrently created", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);

    await insertProposal(batch.id, {
      operation: "CREATE",
      targetPath: `${categoryDirName}/surprise.md`,
      reviewStatus: "approved",
    });

    await writeFile(path.join(vaultRoot, categoryDirName, "surprise.md"), "# Surprise\n");
    git(["add", "."]);
    git(["commit", "-m", "concurrent create"]);

    await expect(submitIngestionBatch(batch.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects a dirty working tree instead of overwriting concurrent uncommitted edits", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);
    await insertProposal(batch.id, { reviewStatus: "approved" });

    await writeFile(path.join(vaultRoot, "uncommitted.md"), "dirty\n");

    await expect(submitIngestionBatch(batch.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns the existing committed result on retry without creating a second commit", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);
    await insertProposal(batch.id, { reviewStatus: "approved" });

    const first = await submitIngestionBatch(batch.id);
    const commitCountAfterFirst = git(["log", "--oneline"]).split("\n").length;

    const second = await submitIngestionBatch(batch.id);

    expect(second.commitSha).toBe(first.commitSha);
    expect(second.appliedCount).toBe(first.appliedCount);
    expect(git(["log", "--oneline"]).split("\n")).toHaveLength(commitCountAfterFirst);
  });

  it("rejects submission when the vault is not configured", async () => {
    const { category, agent } = await configuredCategory();
    const batch = await insertBatch(category.id, agent.id);
    await insertProposal(batch.id, { reviewStatus: "approved" });

    delete process.env.KNOWLEDGE_VAULT_ROOT;

    await expect(submitIngestionBatch(batch.id)).rejects.toBeInstanceOf(KnowledgeIngestionServiceError);
  });
});
