import crypto from "node:crypto";
import { execFile } from "node:child_process";

import { asc, eq } from "drizzle-orm";

import {
  knowledgeProposalDraftBatchSchema,
  MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES,
  type CreateKnowledgeIngestionBatch,
  type KnowledgeIngestionBatch,
  type KnowledgeIngestionBatchDetailResponse,
  type KnowledgeProposal,
  type KnowledgeProposalDraft,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  agents,
  departments,
  knowledgeIngestionBatches,
  knowledgeProposals,
  runs,
} from "../db/schema.js";
import { composeIngestionInstruction } from "../runtime/index.js";
import { resolveEffectiveAgentConfig } from "./agent-config-resolver.js";
import {
  startSnapshotAgentExecution,
  type ExecutionFinalization,
  type SnapshotAgent,
} from "./agent-execution-service.js";
import { assertKnowledgeCategoryReadyForAnalysis, getKnowledgeCategory } from "./knowledge-category-service.js";
import { listCategoryVaultFiles, readCategoryVaultFile } from "./knowledge-vault-fs.js";

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 1024 * 1024;

/** Maximum aggregate characters of existing vault context embedded per ingestion prompt. */
const MAX_EXISTING_VAULT_CONTEXT_CHARS = 20_000;

/** Statuses that already started or finished analysis; retrying is a safe no-op. */
const NON_RESTARTABLE_STATUSES = new Set(["analyzing", "review_ready", "submitting", "committed"]);

export class KnowledgeIngestionServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/** Strips a leading UTF-8 BOM and normalizes CRLF/CR line endings to LF. */
function normalizeContent(rawContent: string): string {
  const withoutBom = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;

  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Rejects content that is blank or contains NUL bytes, which Postgres text columns cannot store. */
function requireUploadableContent(normalized: string): void {
  if (normalized.trim().length === 0) {
    throw new KnowledgeIngestionServiceError("Source content must not be blank", 400);
  }

  if (normalized.includes("\0")) {
    throw new KnowledgeIngestionServiceError("Source content must not contain NUL bytes", 400);
  }
}

/** Hashes normalized text content into the lowercase SHA-256 hex format used across Knowledge ingestion. */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Runs one bounded read-only `git` command against the configured vault root. */
function runVaultGitCommand(vaultRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", vaultRoot, ...args],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

/** Resolves the configured Knowledge vault root, or null when knowledge is not configured. */
function getVaultRoot(): string | null {
  const root = process.env.KNOWLEDGE_VAULT_ROOT;

  return typeof root === "string" && root.trim().length > 0 ? root : null;
}

/** Reads the current Git HEAD commit of the configured vault. */
async function getVaultHeadCommit(vaultRoot: string): Promise<string> {
  try {
    const sha = await runVaultGitCommand(vaultRoot, ["rev-parse", "HEAD"]);

    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new Error("Unexpected rev-parse output");
    }

    return sha.toLowerCase();
  } catch {
    throw new KnowledgeIngestionServiceError(
      "The knowledge vault is not a readable Git repository",
      409,
    );
  }
}

/** Reads the vault's current working-tree status line count, used as a coarse mutation guard. */
async function getVaultWorkingTreeStatus(vaultRoot: string): Promise<string> {
  try {
    return await runVaultGitCommand(vaultRoot, ["status", "--porcelain"]);
  } catch {
    return "";
  }
}

/** Returns true only when targetPath names a Markdown file directly inside the category's vault directory. */
function isTargetPathWithinCategory(vaultRootPath: string, targetPath: string): boolean {
  const prefix = `${vaultRootPath}/`;

  if (!targetPath.startsWith(prefix)) {
    return false;
  }

  const fileName = targetPath.slice(prefix.length);

  return (
    fileName.length > 0 &&
    !fileName.includes("/") &&
    fileName.toLowerCase().endsWith(".md") &&
    fileName.toLowerCase() !== "_index.md" &&
    fileName.toLowerCase() !== "log.md"
  );
}

function serializeBatch(row: typeof knowledgeIngestionBatches.$inferSelect): KnowledgeIngestionBatch {
  return {
    id: row.id,
    knowledgeCategoryId: row.knowledgeCategoryId,
    specialistAgentId: row.specialistAgentId,
    ingestionSkillId: row.ingestionSkillId,
    sourceFileName: row.sourceFileName,
    sourceMediaType: row.sourceMediaType as "text/markdown",
    sourceContentHash: row.sourceContentHash,
    baseVaultCommitSha: row.baseVaultCommitSha,
    status: row.status,
    analysisExecutionId: row.analysisExecutionId,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    committedAt: row.committedAt ? row.committedAt.toISOString() : null,
    vaultCommitSha: row.vaultCommitSha,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeProposal(row: typeof knowledgeProposals.$inferSelect): KnowledgeProposal {
  return {
    id: row.id,
    batchId: row.batchId,
    operation: row.operation,
    targetPath: row.targetPath,
    targetHeading: row.targetHeading,
    confidenceScore: row.confidenceScore,
    confidenceLevel: row.confidenceLevel,
    title: row.title,
    rationale: row.rationale,
    evidence: (row.evidence as string[] | null) ?? [],
    existingContentHash: row.existingContentHash,
    proposedContent: row.proposedContent,
    conflictDetails: row.conflictDetails,
    reviewStatus: row.reviewStatus,
    reviewerNote: row.reviewerNote,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireBatch(id: string): Promise<typeof knowledgeIngestionBatches.$inferSelect> {
  const [batch] = await db.select().from(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.id, id));

  if (!batch) {
    throw new KnowledgeIngestionServiceError("The Knowledge ingestion batch does not exist", 404);
  }

  return batch;
}

async function markBatchFailed(batchId: string, failureReason: string): Promise<void> {
  await db
    .update(knowledgeIngestionBatches)
    .set({ status: "failed", failureReason, updatedAt: new Date() })
    .where(eq(knowledgeIngestionBatches.id, batchId));
}

/** Creates one Knowledge ingestion batch from an uploaded, prepared Markdown source. */
export async function createIngestionBatch(
  categoryId: string,
  input: CreateKnowledgeIngestionBatch,
): Promise<KnowledgeIngestionBatch> {
  const category = await getKnowledgeCategory(categoryId);

  if (!category) {
    throw new KnowledgeIngestionServiceError("The Knowledge Category does not exist", 404);
  }

  const normalized = normalizeContent(input.sourceContent);

  requireUploadableContent(normalized);

  const contentBytes = Buffer.byteLength(normalized, "utf8");

  if (contentBytes > MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES) {
    throw new KnowledgeIngestionServiceError(
      `Source content must not exceed ${MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES} bytes`,
      400,
    );
  }

  const [batch] = await db
    .insert(knowledgeIngestionBatches)
    .values({
      knowledgeCategoryId: categoryId,
      sourceFileName: input.sourceFileName,
      sourceMediaType: input.sourceMediaType,
      sourceContent: normalized,
      sourceContentHash: hashContent(normalized),
      status: "uploaded",
    })
    .returning();

  return serializeBatch(batch);
}

/** Lists Knowledge ingestion batches for one category, most recently created first. */
export async function listIngestionBatches(categoryId: string): Promise<KnowledgeIngestionBatch[]> {
  const category = await getKnowledgeCategory(categoryId);

  if (!category) {
    throw new KnowledgeIngestionServiceError("The Knowledge Category does not exist", 404);
  }

  const rows = await db
    .select()
    .from(knowledgeIngestionBatches)
    .where(eq(knowledgeIngestionBatches.knowledgeCategoryId, categoryId))
    .orderBy(asc(knowledgeIngestionBatches.createdAt));

  return rows.map(serializeBatch);
}

/** Gets one Knowledge ingestion batch and its currently persisted proposals. */
export async function getIngestionBatch(id: string): Promise<KnowledgeIngestionBatchDetailResponse | null> {
  const [batch] = await db.select().from(knowledgeIngestionBatches).where(eq(knowledgeIngestionBatches.id, id));

  if (!batch) {
    return null;
  }

  const proposalRows = await db
    .select()
    .from(knowledgeProposals)
    .where(eq(knowledgeProposals.batchId, id))
    .orderBy(asc(knowledgeProposals.createdAt));

  return { batch: serializeBatch(batch), proposals: proposalRows.map(serializeProposal) };
}

/**
 * Validates and persists the specialist's proposal batch once its execution reports a
 * completed structured result. Invalid or out-of-category output fails the whole batch
 * without persisting any proposal, so retries never see partial results.
 */
async function finalizeAnalysis(
  batchId: string,
  vaultRootPath: string,
  finalization: ExecutionFinalization,
  vaultDirtyAfterExecution: boolean,
): Promise<void> {
  if (vaultDirtyAfterExecution) {
    await markBatchFailed(
      batchId,
      "The knowledge vault working tree changed during analysis. The specialist is not permitted to write to the vault.",
    );
    return;
  }

  if (finalization.status !== "completed" || finalization.resultStatus !== "completed" || !finalization.result) {
    await markBatchFailed(
      batchId,
      finalization.failureReason ?? "The specialist execution did not complete successfully.",
    );
    return;
  }

  const { result } = finalization;

  if (result.commit !== null || result.filesChanged.length > 0) {
    await markBatchFailed(
      batchId,
      "The specialist reported a commit or file changes, but ingestion specialists are not permitted to mutate the vault.",
    );
    return;
  }

  const rawProposals = (result.details as { proposals?: unknown }).proposals ?? [];

  const parsed = knowledgeProposalDraftBatchSchema.safeParse(rawProposals);

  if (!parsed.success) {
    await markBatchFailed(
      batchId,
      `The specialist's structured output did not match the required proposal contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
    return;
  }

  const outOfCategory = parsed.data.find((proposal) => !isTargetPathWithinCategory(vaultRootPath, proposal.targetPath));

  if (outOfCategory) {
    await markBatchFailed(
      batchId,
      `Proposal target "${outOfCategory.targetPath}" is outside this Knowledge Category's managed vault directory.`,
    );
    return;
  }

  await db.transaction(async (tx) => {
    if (parsed.data.length > 0) {
      await tx.insert(knowledgeProposals).values(
        parsed.data.map((proposal: KnowledgeProposalDraft) => ({
          batchId,
          operation: proposal.operation,
          targetPath: proposal.targetPath,
          targetHeading: proposal.targetHeading ?? null,
          confidenceScore: proposal.confidenceScore,
          confidenceLevel: proposal.confidenceLevel,
          title: proposal.title,
          rationale: proposal.rationale,
          evidence: proposal.evidence,
          existingContentHash: proposal.existingContentHash ?? null,
          proposedContent: proposal.proposedContent,
          conflictDetails: proposal.conflictDetails ?? null,
        })),
      );
    }

    await tx
      .update(knowledgeIngestionBatches)
      .set({ status: "review_ready", failureReason: null, updatedAt: new Date() })
      .where(eq(knowledgeIngestionBatches.id, batchId));
  });
}

/**
 * Starts (or safely re-observes) the configured specialist's proposal-only analysis of one
 * uploaded batch. Snapshots specialist, skill, and base vault commit before launching so the
 * later publisher (Slice 5) can detect a stale or concurrently edited vault. Never mutates the
 * vault itself; the specialist runs with write/command/commit capability structurally disabled.
 */
export async function startIngestionAnalysis(batchId: string): Promise<KnowledgeIngestionBatch> {
  const batch = await requireBatch(batchId);

  if (NON_RESTARTABLE_STATUSES.has(batch.status)) {
    return serializeBatch(batch);
  }

  const category = await getKnowledgeCategory(batch.knowledgeCategoryId);

  if (!category) {
    throw new KnowledgeIngestionServiceError("The Knowledge Category no longer exists", 404);
  }

  await assertKnowledgeCategoryReadyForAnalysis(category);

  const vaultRoot = getVaultRoot();

  if (!vaultRoot) {
    throw new KnowledgeIngestionServiceError("The knowledge vault is not currently configured or reachable", 409);
  }

  const baseVaultCommitSha = await getVaultHeadCommit(vaultRoot);

  const [specialistRow] = await db
    .select()
    .from(agents)
    .innerJoin(departments, eq(agents.departmentId, departments.id))
    .where(eq(agents.id, category.specialistAgentId as string));

  if (!specialistRow) {
    throw new KnowledgeIngestionServiceError("The configured specialist Agent no longer exists", 404);
  }

  const effective = resolveEffectiveAgentConfig(specialistRow.agents, specialistRow.departments);

  const existingFilesResult = await listCategoryVaultFiles(category.vaultRootPath);

  const existingVaultFiles: { path: string; content: string }[] = [];
  let remainingChars = MAX_EXISTING_VAULT_CONTEXT_CHARS;

  if (existingFilesResult.status === "ok") {
    for (const file of existingFilesResult.files) {
      if (remainingChars <= 0) break;

      const content = await readCategoryVaultFile(category.vaultRootPath, file.path);

      if (content.status === "ok" && content.file) {
        const excerpt = content.file.content.slice(0, remainingChars);
        existingVaultFiles.push({ path: file.path, content: excerpt });
        remainingChars -= excerpt.length;
      }
    }
  }

  const instruction = composeIngestionInstruction({
    categoryName: category.name,
    categoryDescription: category.description,
    vaultRootPath: category.vaultRootPath,
    sourceFileName: batch.sourceFileName,
    sourceContent: batch.sourceContent,
    existingVaultFiles,
  });

  const snapshotAgent: SnapshotAgent = {
    id: specialistRow.agents.id,
    name: specialistRow.agents.name,
    role: effective.role,
    layer: 1,
    executionOrder: 1,
    harness: effective.harness,
    model: effective.model,
    reasoning: effective.reasoning,
    systemPrompt: effective.systemPrompt,
    canWrite: false,
    canRunCommands: false,
    sandboxMode: "read-only",
    canCommit: false,
  };

  await db
    .update(knowledgeIngestionBatches)
    .set({
      specialistAgentId: category.specialistAgentId,
      ingestionSkillId: category.ingestionSkillId,
      baseVaultCommitSha,
      status: "analyzing",
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeIngestionBatches.id, batchId));

  const [run] = await db.insert(runs).values({ projectPath: vaultRoot }).returning();

  const vaultStatusBeforeExecution = await getVaultWorkingTreeStatus(vaultRoot);

  const execution = await startSnapshotAgentExecution(run, snapshotAgent, instruction, async (finalization) => {
    const vaultStatusAfterExecution = await getVaultWorkingTreeStatus(vaultRoot);

    await finalizeAnalysis(
      batchId,
      category.vaultRootPath,
      finalization,
      vaultStatusAfterExecution !== vaultStatusBeforeExecution,
    );
  });

  const [updated] = await db
    .update(knowledgeIngestionBatches)
    .set({ analysisExecutionId: execution.id, updatedAt: new Date() })
    .where(eq(knowledgeIngestionBatches.id, batchId))
    .returning();

  return serializeBatch(updated);
}
