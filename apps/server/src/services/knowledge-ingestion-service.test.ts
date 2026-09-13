import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentResult } from "@orc/shared";

const mocks = vi.hoisted(() => ({
  startSnapshotAgentExecution: vi.fn(),
}));

vi.mock("./agent-execution-service.js", () => ({
  startSnapshotAgentExecution: mocks.startSnapshotAgentExecution,
}));

const { db } = await import("../db/client.js");
const {
  agentExecutions,
  agentSkills,
  agents,
  departments,
  knowledgeCategories,
  knowledgeIngestionBatches,
  runs,
  skills,
} = await import("../db/schema.js");
const { createKnowledgeCategory } = await import("./knowledge-category-service.js");
const {
  KnowledgeIngestionServiceError,
  computeBatchReadiness,
  createIngestionBatch,
  getIngestionBatch,
  listIngestionBatches,
  reviewProposal,
  startIngestionAnalysis,
} = await import("./knowledge-ingestion-service.js");

const createdCategoryIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdDepartmentIds = new Set<string>();
const createdSkillIds = new Set<string>();
const createdExecutionIds = new Set<string>();
const originalVaultRoot = process.env.KNOWLEDGE_VAULT_ROOT;
let vaultRoot: string;

/** Builds the generic completed structured result shape a specialist reports for analysis. */
function completedResult(proposals: unknown[]): AgentResult {
  return {
    status: "completed",
    summary: "Analyzed the uploaded source against existing category knowledge.",
    details: { proposals },
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
  };
}

function validDraftProposal(vaultRootPath: string, overrides: Record<string, unknown> = {}) {
  return {
    operation: "CREATE",
    targetPath: `${vaultRootPath}/new-topic.md`,
    title: "New Topic",
    rationale: "The source introduces guidance not yet captured.",
    confidenceScore: 0.9,
    confidenceLevel: "high",
    evidence: ["Source explicitly describes this rule."],
    proposedContent: "# New Topic\n\nGuidance body.",
    ...overrides,
  };
}

/**
 * Captures the onFinalized callback the service registers so tests can drive it directly,
 * standing in for the real runtime's eventual completion. Also inserts the minimal
 * agentExecutions row the real service would have created, satisfying the batch's foreign key.
 */
function captureFinalizer(): {
  invoke: (finalization: unknown) => Promise<void>;
} {
  let finalizer: ((finalization: unknown) => Promise<void>) | undefined;

  mocks.startSnapshotAgentExecution.mockImplementation(
    async (
      run: { id: string },
      agent: { id: string; name: string; role: string; layer: number; executionOrder: number; harness: string; model: string; reasoning: string },
      _instruction: string,
      onFinalized: (finalization: unknown) => Promise<void>,
    ) => {
      finalizer = onFinalized;

      const [execution] = await db
        .insert(agentExecutions)
        .values({
          runId: run.id,
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          layer: agent.layer,
          executionOrder: agent.executionOrder,
          harness: agent.harness as "claude" | "codex",
          model: agent.model,
          reasoning: agent.reasoning,
          status: "running",
        })
        .returning();

      createdExecutionIds.add(execution.id);

      return { id: execution.id };
    },
  );

  return {
    invoke: async (finalization) => {
      if (!finalizer) throw new Error("Finalizer was not captured");
      await finalizer(finalization);
    },
  };
}

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "orc-knowledge-ingestion-"));
  process.env.KNOWLEDGE_VAULT_ROOT = vaultRoot;

  execFileSync("git", ["init"], { cwd: vaultRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: vaultRoot });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: vaultRoot });
  await writeFile(path.join(vaultRoot, "README.md"), "# Vault\n");
  execFileSync("git", ["add", "."], { cwd: vaultRoot });
  execFileSync("git", ["commit", "-m", "init"], { cwd: vaultRoot });

  mocks.startSnapshotAgentExecution.mockReset();
});

afterEach(async () => {
  for (const id of createdCategoryIds) {
    await db.delete(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.knowledgeCategoryId, id));
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
  }
  createdCategoryIds.clear();

  for (const id of createdExecutionIds) await db.delete(agentExecutions).where(eq(agentExecutions.id, id));
  createdExecutionIds.clear();

  await db.delete(runs).where(eq(runs.projectPath, vaultRoot));

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

/** Creates a Knowledge Category configured with an enabled specialist owning an enabled ingestion Skill. */
async function configuredCategory(label: string) {
  const suffix = crypto.randomUUID();

  const [department] = await db
    .insert(departments)
    .values({
      slug: `knowledge-ingest-department-${suffix}`,
      name: "Knowledge Ingest Department",
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
    .values({ departmentId: department.id, slug: `knowledge-ingest-agent-${suffix}`, name: "Ingest Specialist", enabled: true })
    .returning();
  createdAgentIds.add(agent.id);

  const [skill] = await db
    .insert(skills)
    .values({ slug: `knowledge-ingest-skill-${suffix}`, name: "Ingest Skill", enabled: true })
    .returning();
  createdSkillIds.add(skill.id);

  await db.insert(agentSkills).values({ agentId: agent.id, skillId: skill.id });

  const category = await createKnowledgeCategory({
    slug: `knowledge-ingest-${label}-${suffix}`,
    name: `Ingest ${label}`,
    description: "",
    vaultRootPath: `wiki/${label}`,
    enabled: true,
    specialistAgentId: agent.id,
    ingestionSkillId: skill.id,
  });
  createdCategoryIds.add(category.id);

  return { category, agent, skill, department };
}

async function currentVaultHead(): Promise<string> {
  return execFileSync("git", ["-C", vaultRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

describe("knowledge-ingestion-service", () => {
  it("uploads a Markdown source and persists an ingestion batch without touching the vault", async () => {
    const { category } = await configuredCategory("upload");

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nSome durable guidance.",
    });

    expect(batch.status).toBe("uploaded");
    expect(batch.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.baseVaultCommitSha).toBeNull();

    const listed = await listIngestionBatches(category.id);
    expect(listed.map((row) => row.id)).toContain(batch.id);
  });

  it("rejects blank uploaded source content", async () => {
    const { category } = await configuredCategory("blank");

    await expect(
      createIngestionBatch(category.id, {
        sourceFileName: "knowledge.md",
        sourceMediaType: "text/markdown",
        sourceContent: "   \n  ",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("snapshots the specialist, Skill, and base vault commit SHA once analysis starts", async () => {
    const { category, agent, skill } = await configuredCategory("snapshot");
    captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    const started = await startIngestionAnalysis(batch.id);

    expect(started.status).toBe("analyzing");
    expect(started.specialistAgentId).toBe(agent.id);
    expect(started.ingestionSkillId).toBe(skill.id);
    expect(started.baseVaultCommitSha).toBe(await currentVaultHead());
    expect(mocks.startSnapshotAgentExecution).toHaveBeenCalledTimes(1);
  });

  it("retrying analyze while already analyzing does not start a second execution", async () => {
    const { category } = await configuredCategory("idempotent");
    captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);
    const second = await startIngestionAnalysis(batch.id);

    expect(second.status).toBe("analyzing");
    expect(mocks.startSnapshotAgentExecution).toHaveBeenCalledTimes(1);
  });

  it("persists validated CREATE/UPDATE/NO_CHANGE proposals and marks the batch review_ready", async () => {
    const { category } = await configuredCategory("proposals");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    const proposals = [
      validDraftProposal(category.vaultRootPath),
      { ...validDraftProposal(category.vaultRootPath, { operation: "NO_CHANGE", targetPath: `${category.vaultRootPath}/existing.md` }) },
    ];

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult(proposals),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("review_ready");
    expect(detail?.proposals).toHaveLength(2);
    expect(detail?.proposals.map((proposal) => proposal.operation).sort()).toEqual(["CREATE", "NO_CHANGE"]);
    expect(detail?.proposals.every((proposal) => proposal.reviewStatus === "pending")).toBe(true);
  });

  it("completes the independent observability run when the specialist completes", async () => {
    const { category } = await configuredCategory("run-completion");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    const run = mocks.startSnapshotAgentExecution.mock.calls[0]?.[0] as { id: string } | undefined;
    expect(run).toBeDefined();

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([validDraftProposal(category.vaultRootPath)]),
    });

    const [persistedRun] = await db.select().from(runs).where(eq(runs.id, run!.id));
    expect(persistedRun?.status).toBe("completed");
  });

  it("treats a blank optional target heading as omitted", async () => {
    const { category } = await configuredCategory("blank-target-heading");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([
        validDraftProposal(category.vaultRootPath, { targetHeading: "" }),
      ]),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("review_ready");
    expect(detail?.proposals).toHaveLength(1);
    expect(detail?.proposals[0]?.targetHeading).toBeNull();
  });

  it("rejects malformed specialist output without persisting any proposal", async () => {
    const { category } = await configuredCategory("malformed");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([{ operation: "CREATE", title: "Missing required fields" }]),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.batch.failureReason).toMatch(/proposal contract/i);
    expect(detail?.proposals).toHaveLength(0);
  });

  it("rejects an unsupported proposal operation", async () => {
    const { category } = await configuredCategory("unsupported-op");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([validDraftProposal(category.vaultRootPath, { operation: "DELETE" })]),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.proposals).toHaveLength(0);
  });

  it("rejects an out-of-category proposal target without persisting any proposal", async () => {
    const { category } = await configuredCategory("out-of-category");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([validDraftProposal("wiki/some-other-category")]),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.batch.failureReason).toMatch(/outside this Knowledge Category/i);
    expect(detail?.proposals).toHaveLength(0);
  });

  it("rejects a specialist result that reports a commit or file changes", async () => {
    const { category } = await configuredCategory("no-mutation");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: {
        ...completedResult([validDraftProposal(category.vaultRootPath)]),
        filesChanged: ["wiki/upload/new-topic.md"],
      },
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.batch.failureReason).toMatch(/not permitted to mutate/i);
  });

  it("fails the batch when the vault working tree changed during analysis", async () => {
    const { category } = await configuredCategory("dirty-tree");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await writeFile(path.join(vaultRoot, "unexpected.md"), "surprise\n");

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([validDraftProposal(category.vaultRootPath)]),
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.batch.failureReason).toMatch(/working tree changed/i);
    expect(detail?.proposals).toHaveLength(0);
  });

  it("fails the batch when the underlying execution did not complete successfully", async () => {
    const { category } = await configuredCategory("execution-failed");
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "failed",
      resultStatus: null,
      failureReason: "Worker exited with code 1.",
      result: null,
    });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.batch.status).toBe("failed");
    expect(detail?.batch.failureReason).toBe("Worker exited with code 1.");
  });

  it("rejects starting analysis when the specialist/Skill configuration is not ready", async () => {
    const category = await createKnowledgeCategory({
      slug: `knowledge-ingest-unready-${crypto.randomUUID()}`,
      name: "Unready",
      description: "",
      vaultRootPath: "wiki/unready",
      enabled: true,
    });
    createdCategoryIds.add(category.id);

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await expect(startIngestionAnalysis(batch.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.startSnapshotAgentExecution).not.toHaveBeenCalled();
  });

  it("reports knowledge_unavailable when the vault is not configured at analysis start", async () => {
    const { category } = await configuredCategory("no-vault");

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    delete process.env.KNOWLEDGE_VAULT_ROOT;

    await expect(startIngestionAnalysis(batch.id)).rejects.toBeInstanceOf(KnowledgeIngestionServiceError);
  });
});

describe("knowledge-ingestion-service review queue", () => {
  /** Analyzes a batch to review_ready with one CREATE, one CONFLICT, and one NO_CHANGE proposal. */
  async function reviewReadyBatch(label: string) {
    const { category } = await configuredCategory(label);
    const finalizer = captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    await startIngestionAnalysis(batch.id);

    await finalizer.invoke({
      executionId: crypto.randomUUID(),
      status: "completed",
      resultStatus: "completed",
      failureReason: null,
      result: completedResult([
        validDraftProposal(category.vaultRootPath, { targetPath: `${category.vaultRootPath}/new.md` }),
        validDraftProposal(category.vaultRootPath, {
          operation: "CONFLICT",
          targetPath: `${category.vaultRootPath}/conflicting.md`,
          conflictDetails: "Contradicts existing canonical guidance.",
        }),
        validDraftProposal(category.vaultRootPath, {
          operation: "NO_CHANGE",
          targetPath: `${category.vaultRootPath}/existing.md`,
        }),
      ]),
    });

    const detail = await getIngestionBatch(batch.id);
    if (!detail) throw new Error("Batch detail unexpectedly missing");

    return { category, batch: detail.batch, proposals: detail.proposals };
  }

  it("blocks readiness while any actionable proposal is pending", async () => {
    const { batch, proposals } = await reviewReadyBatch("pending-blocks");

    const readiness = computeBatchReadiness(batch, proposals);
    expect(readiness.ready).toBe(false);
    expect(readiness.pendingCount).toBe(2);
    expect(readiness.blockingReasons.some((reason) => reason.includes("awaiting a decision"))).toBe(true);
  });

  it("does not let NO_CHANGE proposals block readiness even while pending", async () => {
    const { batch, proposals } = await reviewReadyBatch("no-change-nonblocking");
    const create = proposals.find((p) => p.operation === "CREATE")!;
    const conflict = proposals.find((p) => p.operation === "CONFLICT")!;

    await reviewProposal(batch.id, create.id, { reviewStatus: "approved" });
    await reviewProposal(batch.id, conflict.id, { reviewStatus: "denied" });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.readiness.ready).toBe(true);
    expect(detail?.readiness.noChangeCount).toBe(1);
    expect(detail?.proposals.find((p) => p.operation === "NO_CHANGE")?.reviewStatus).toBe("pending");
  });

  it("blocks readiness until a CONFLICT is explicitly approved or denied", async () => {
    const { batch, proposals } = await reviewReadyBatch("conflict-blocks");
    const create = proposals.find((p) => p.operation === "CREATE")!;
    const conflict = proposals.find((p) => p.operation === "CONFLICT")!;

    await reviewProposal(batch.id, create.id, { reviewStatus: "approved" });

    let detail = await getIngestionBatch(batch.id);
    expect(detail?.readiness.ready).toBe(false);
    expect(detail?.readiness.unresolvedConflictCount).toBe(1);

    await reviewProposal(batch.id, conflict.id, { reviewStatus: "denied" });

    detail = await getIngestionBatch(batch.id);
    expect(detail?.readiness.ready).toBe(true);
    expect(detail?.readiness.unresolvedConflictCount).toBe(0);
  });

  it("blocks readiness while a proposal remains needs_changes", async () => {
    const { batch, proposals } = await reviewReadyBatch("needs-changes-blocks");
    const create = proposals.find((p) => p.operation === "CREATE")!;
    const conflict = proposals.find((p) => p.operation === "CONFLICT")!;

    await reviewProposal(batch.id, create.id, { reviewStatus: "needs_changes", reviewerNote: "Tighten the wording." });
    await reviewProposal(batch.id, conflict.id, { reviewStatus: "denied" });

    const detail = await getIngestionBatch(batch.id);
    expect(detail?.readiness.ready).toBe(false);
    expect(detail?.readiness.needsChangesCount).toBe(1);
  });

  it("persists a reviewer note and retains it across a later decision change", async () => {
    const { batch, proposals } = await reviewReadyBatch("note-persists");
    const create = proposals.find((p) => p.operation === "CREATE")!;

    const first = await reviewProposal(batch.id, create.id, {
      reviewStatus: "needs_changes",
      reviewerNote: "Please cite a source.",
    });
    expect(first.reviewerNote).toBe("Please cite a source.");

    const second = await reviewProposal(batch.id, create.id, { reviewStatus: "approved" });
    expect(second.reviewerNote).toBe("Please cite a source.");

    const third = await reviewProposal(batch.id, create.id, { reviewStatus: "denied", reviewerNote: null });
    expect(third.reviewerNote).toBeNull();
  });

  it("retains a denied proposal permanently rather than deleting it", async () => {
    const { batch, proposals } = await reviewReadyBatch("denied-retained");
    const create = proposals.find((p) => p.operation === "CREATE")!;

    await reviewProposal(batch.id, create.id, { reviewStatus: "denied" });

    const detail = await getIngestionBatch(batch.id);
    const denied = detail?.proposals.find((p) => p.id === create.id);
    expect(denied?.reviewStatus).toBe("denied");
    expect(denied).toBeDefined();
  });

  it("rejects an unknown proposal id for a real batch", async () => {
    const { batch } = await reviewReadyBatch("unknown-proposal");

    await expect(
      reviewProposal(batch.id, crypto.randomUUID(), { reviewStatus: "approved" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects reviewing a proposal once its batch is no longer review_ready or failed", async () => {
    const { category } = await configuredCategory("not-reviewable");
    captureFinalizer();

    const batch = await createIngestionBatch(category.id, {
      sourceFileName: "knowledge.md",
      sourceMediaType: "text/markdown",
      sourceContent: "# Notes\n\nDurable guidance.",
    });

    // Still "uploaded" — analysis has not produced any proposal yet.
    await expect(
      reviewProposal(batch.id, crypto.randomUUID(), { reviewStatus: "approved" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
