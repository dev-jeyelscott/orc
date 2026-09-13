import crypto from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq, inArray } from "drizzle-orm";

import type { KnowledgeProposal, SubmitKnowledgeIngestionBatchResponse } from "@orc/shared";

import { db } from "../db/client.js";
import { agents, knowledgeIngestionBatches, knowledgeProposals } from "../db/schema.js";
import { getKnowledgeCategory } from "./knowledge-category-service.js";
import {
  KnowledgeIngestionServiceError,
  computeBatchReadiness,
  isTargetPathWithinCategory,
  markBatchFailed,
  requireBatch,
  serializeBatch,
  serializeProposal,
} from "./knowledge-ingestion-service.js";
import { getVaultRoot, getVaultWorkingTreeStatus, runVaultGitCommand } from "./knowledge-vault-git.js";

/** Statuses from which a submit attempt may (re)start. `committed` is handled idempotently before this check. */
const SUBMIT_RESTARTABLE_STATUSES = new Set(["review_ready", "failed", "submitting"]);

/** One global in-process lock: V1 publishes at most one Knowledge batch at a time. */
let publishing = false;

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** Resolves a category's vault-relative directory to an absolute path, rejecting any traversal. */
function resolveCategoryDirectory(vaultRoot: string, vaultRootPath: string): string | null {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedDirectory = path.resolve(resolvedRoot, vaultRootPath);
  const relative = path.relative(resolvedRoot, resolvedDirectory);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolvedDirectory;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function readFileIfExists(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

/** Best-effort restoration of one category directory to its last-committed Git state. */
async function rollbackCategoryDirectory(vaultRoot: string, categoryRelativeDir: string): Promise<void> {
  try {
    await runVaultGitCommand(vaultRoot, ["reset", "--", categoryRelativeDir]);
    await runVaultGitCommand(vaultRoot, ["checkout", "--", categoryRelativeDir]);
    await runVaultGitCommand(vaultRoot, ["clean", "-fd", "--", categoryRelativeDir]);
  } catch {
    // Best-effort: the batch is already being marked failed; a rollback failure surfaces via failureReason.
  }
}

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 12);
}

function renderIndex(categoryName: string, description: string, fileNames: string[], batchId: string): string {
  const lines = [
    `# ${categoryName}`,
    "",
    description || "No description.",
    "",
    "## Managed Notes",
    "",
    ...(fileNames.length > 0 ? fileNames.map((name) => `- ${name}`) : ["_No managed notes yet._"]),
    "",
    `_Last ingestion batch: ${shortId(batchId)}, generated ${new Date().toISOString()}._`,
    "",
  ];

  return lines.join("\n");
}

function renderLogEntry(params: {
  batchId: string;
  sourceFileName: string;
  specialistName: string;
  applied: KnowledgeProposal[];
  denied: KnowledgeProposal[];
  noChangeCount: number;
}): string {
  const { batchId, sourceFileName, specialistName, applied, denied, noChangeCount } = params;

  // The commit that carries this entry cannot embed its own final SHA (writing the SHA
  // changes the commit's content, which changes its SHA). The batch row's `vaultCommitSha`
  // is the authoritative pointer; ORC batch history is the place to look it up.
  const lines = [
    `## ${new Date().toISOString()} — batch ${shortId(batchId)}`,
    "",
    `- Source: \`${sourceFileName}\``,
    `- Specialist: ${specialistName}`,
    `- Applied: ${applied.length} (${applied.map((proposal) => `${proposal.operation} ${proposal.targetPath}`).join("; ") || "none"})`,
    `- Denied: ${denied.length}`,
    `- No change: ${noChangeCount}`,
    `- ORC batch: ${batchId}`,
    "",
  ];

  return lines.join("\n");
}

/**
 * Applies only explicitly approved proposals from one review-ready batch, regenerates the
 * category's `_index.md`/`log.md`, and creates exactly one Git commit. Never touches denied,
 * needs_changes, or NO_CHANGE proposals. Idempotent: a batch already `committed` returns its
 * existing result without touching the vault again.
 */
export async function submitIngestionBatch(batchId: string): Promise<SubmitKnowledgeIngestionBatchResponse> {
  const initialBatch = await requireBatch(batchId);

  if (initialBatch.status === "committed") {
    const proposalRows = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.batchId, batchId));
    const proposals = proposalRows.map(serializeProposal);

    return {
      batch: serializeBatch(initialBatch),
      appliedCount: proposals.filter((proposal) => proposal.appliedAt !== null).length,
      deniedCount: proposals.filter((proposal) => proposal.reviewStatus === "denied").length,
      noChangeCount: proposals.filter((proposal) => proposal.operation === "NO_CHANGE").length,
      commitSha: initialBatch.vaultCommitSha,
    };
  }

  if (!SUBMIT_RESTARTABLE_STATUSES.has(initialBatch.status)) {
    throw new KnowledgeIngestionServiceError(
      `Batch cannot be submitted while it is ${initialBatch.status}`,
      409,
    );
  }

  if (publishing) {
    throw new KnowledgeIngestionServiceError("Another Knowledge batch is currently being published", 409);
  }

  publishing = true;

  try {
    const category = await getKnowledgeCategory(initialBatch.knowledgeCategoryId);

    if (!category) {
      throw new KnowledgeIngestionServiceError("The Knowledge Category no longer exists", 404);
    }

    const vaultRoot = getVaultRoot();

    if (!vaultRoot) {
      throw new KnowledgeIngestionServiceError("The knowledge vault is not currently configured or reachable", 409);
    }

    const proposalRows = await db.select().from(knowledgeProposals).where(eq(knowledgeProposals.batchId, batchId));
    const proposals = proposalRows.map(serializeProposal);
    const readiness = computeBatchReadiness(initialBatch, proposals);

    if (!readiness.ready) {
      throw new KnowledgeIngestionServiceError(
        `Batch is not ready to submit: ${readiness.blockingReasons.join(" ")}`,
        409,
      );
    }

    await db
      .update(knowledgeIngestionBatches)
      .set({
        status: "submitting",
        submittedAt: initialBatch.submittedAt ?? new Date(),
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeIngestionBatches.id, batchId));

    const categoryDir = resolveCategoryDirectory(vaultRoot, category.vaultRootPath);

    if (!categoryDir) {
      await markBatchFailed(batchId, "The Knowledge Category's vault directory is invalid");
      throw new KnowledgeIngestionServiceError("The Knowledge Category's vault directory is invalid", 409);
    }

    try {
      const workingTreeStatus = await getVaultWorkingTreeStatus(vaultRoot);

      if (workingTreeStatus.trim().length > 0) {
        throw new KnowledgeIngestionServiceError(
          "The knowledge vault working tree is not clean; publishing was aborted to avoid overwriting concurrent edits",
          409,
        );
      }

      const approved = proposals.filter(
        (proposal) => proposal.operation !== "NO_CHANGE" && proposal.reviewStatus === "approved",
      );
      const denied = proposals.filter(
        (proposal) => proposal.operation !== "NO_CHANGE" && proposal.reviewStatus === "denied",
      );
      const noChangeCount = proposals.length - proposals.filter((p) => p.operation !== "NO_CHANGE").length;

      const targets: { proposal: KnowledgeProposal; absolutePath: string; relativePath: string }[] = [];

      for (const proposal of approved) {
        if (!isTargetPathWithinCategory(category.vaultRootPath, proposal.targetPath)) {
          throw new KnowledgeIngestionServiceError(
            `Approved proposal target "${proposal.targetPath}" is outside this Knowledge Category's vault directory`,
            409,
          );
        }

        const fileName = proposal.targetPath.slice(`${category.vaultRootPath}/`.length);
        const absolutePath = path.resolve(categoryDir, fileName);

        if (path.dirname(absolutePath) !== categoryDir) {
          throw new KnowledgeIngestionServiceError(
            `Approved proposal target "${proposal.targetPath}" escapes the category vault directory`,
            409,
          );
        }

        const currentContent = await readFileIfExists(absolutePath);
        const currentHash = currentContent === null ? null : hashContent(currentContent);

        if (proposal.operation === "CREATE" && currentContent !== null) {
          throw new KnowledgeIngestionServiceError(
            `Proposal target "${proposal.targetPath}" was created concurrently outside this batch`,
            409,
          );
        }

        if (proposal.operation !== "CREATE" && proposal.existingContentHash && currentHash !== proposal.existingContentHash) {
          throw new KnowledgeIngestionServiceError(
            `Proposal target "${proposal.targetPath}" changed since analysis; re-run analysis before submitting`,
            409,
          );
        }

        targets.push({ proposal, absolutePath, relativePath: proposal.targetPath });
      }

      for (const target of targets) {
        await writeFile(target.absolutePath, target.proposal.proposedContent, "utf8");
      }

      const existingFileNames = new Set<string>();

      for (const target of targets) {
        existingFileNames.add(path.basename(target.absolutePath));
      }

      // Merge with files already present in the directory (untouched by this batch) for the index.
      const entries = await readdir(categoryDir, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !["_index.md", "log.md"].includes(entry.name.toLowerCase())) {
          existingFileNames.add(entry.name);
        }
      }

      const indexPath = path.join(categoryDir, "_index.md");
      const logPath = path.join(categoryDir, "log.md");
      const indexRelativePath = `${category.vaultRootPath}/_index.md`;
      const logRelativePath = `${category.vaultRootPath}/log.md`;

      await writeFile(
        indexPath,
        renderIndex(category.name, category.description, Array.from(existingFileNames).sort(), batchId),
        "utf8",
      );

      const [specialistRow] = initialBatch.specialistAgentId
        ? await db.select({ name: agents.name }).from(agents).where(eq(agents.id, initialBatch.specialistAgentId))
        : [];

      const existingLog = await readFileIfExists(logPath);
      const logEntry = renderLogEntry({
        batchId,
        sourceFileName: initialBatch.sourceFileName,
        specialistName: specialistRow?.name ?? "Unknown specialist",
        applied: targets.map((t) => t.proposal),
        denied,
        noChangeCount,
      });

      await writeFile(logPath, `${logEntry}\n${existingLog ?? ""}`, "utf8");

      const touchedRelativePaths = [
        ...targets.map((target) => target.relativePath),
        indexRelativePath,
        logRelativePath,
      ];

      await runVaultGitCommand(vaultRoot, ["add", "--", ...touchedRelativePaths]);

      const stagedDiff = await runVaultGitCommand(vaultRoot, ["diff", "--cached", "--name-only"]);
      const stagedPaths = stagedDiff.split("\n").map((line) => line.trim()).filter(Boolean);
      const allowlist = new Set(touchedRelativePaths);

      if (stagedPaths.some((stagedPath) => !allowlist.has(stagedPath))) {
        throw new KnowledgeIngestionServiceError(
          "Publishing would touch files outside the expected category and generated files; aborted",
          409,
        );
      }

      const shortBatchId = batchId.slice(0, 8);
      const commitMessage = `knowledge(${category.slug}): ingest batch ${shortBatchId}`;

      await runVaultGitCommand(vaultRoot, ["commit", "-m", commitMessage]);
      const finalCommitSha = await runVaultGitCommand(vaultRoot, ["rev-parse", "HEAD"]);

      const appliedIds = targets.map((target) => target.proposal.id);

      const [committedBatch] = await db
        .update(knowledgeIngestionBatches)
        .set({
          status: "committed",
          committedAt: new Date(),
          vaultCommitSha: finalCommitSha,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeIngestionBatches.id, batchId))
        .returning();

      if (appliedIds.length > 0) {
        await db
          .update(knowledgeProposals)
          .set({ appliedAt: new Date(), updatedAt: new Date() })
          .where(inArray(knowledgeProposals.id, appliedIds));
      }

      return {
        batch: serializeBatch(committedBatch),
        appliedCount: appliedIds.length,
        deniedCount: denied.length,
        noChangeCount,
        commitSha: finalCommitSha,
      };
    } catch (error) {
      await rollbackCategoryDirectory(vaultRoot, category.vaultRootPath);

      const message = error instanceof Error ? error.message : "Knowledge vault publishing failed unexpectedly";
      await markBatchFailed(batchId, message);

      if (error instanceof KnowledgeIngestionServiceError) {
        throw error;
      }

      throw new KnowledgeIngestionServiceError(message, 500);
    }
  } finally {
    publishing = false;
  }
}
