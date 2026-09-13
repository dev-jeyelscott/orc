import { z } from "zod";

import { knowledgePathSchema, MAX_KNOWLEDGE_TITLE_CHARS } from "./knowledge.js";

export const MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES = 1_048_576;

export const MAX_KNOWLEDGE_PROPOSAL_RATIONALE_CHARS = 4_000;

export const MAX_KNOWLEDGE_PROPOSAL_CONTENT_CHARS = 20_000;

export const MAX_KNOWLEDGE_PROPOSAL_EVIDENCE_ITEMS = 10;

export const MAX_KNOWLEDGE_PROPOSAL_EVIDENCE_CHARS = 500;

export const MAX_KNOWLEDGE_PROPOSALS_PER_BATCH = 50;

export const MAX_KNOWLEDGE_REVIEWER_NOTE_CHARS = 2_000;

export const knowledgeContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Content hashes must be lowercase SHA-256 hex values");

export const knowledgeIngestionBatchStatusSchema = z.enum([
  "uploaded",
  "analyzing",
  "review_ready",
  "submitting",
  "committed",
  "failed",
]);

export const knowledgeProposalOperationSchema = z.enum([
  "CREATE",
  "UPDATE",
  "MERGE",
  "CONFLICT",
  "NO_CHANGE",
]);

export const knowledgeProposalConfidenceLevelSchema = z.enum(["low", "medium", "high"]);

export const knowledgeProposalReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "needs_changes",
]);

/** Source upload accepted from the operator. V1 restricts ingestible sources to Markdown text. */
export const createKnowledgeIngestionBatchSchema = z
  .object({
    sourceFileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => value.toLowerCase().endsWith(".md"), {
        message: "Source file name must end with .md",
      }),
    sourceMediaType: z.literal("text/markdown"),
    sourceContent: z.string().min(1).max(MAX_KNOWLEDGE_SOURCE_UPLOAD_BYTES),
  })
  .strict();

/**
 * Strict contract a configured specialist must emit (inside its structured completion's
 * `details.proposals`) for one recommendation. Never trusted without server-side validation;
 * the specialist itself never writes or commits the vault.
 */
export const knowledgeProposalDraftSchema = z
  .object({
    operation: knowledgeProposalOperationSchema,
    targetPath: knowledgePathSchema,
    targetHeading: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().min(1).max(300).optional(),
    ),
    title: z.string().trim().min(1).max(MAX_KNOWLEDGE_TITLE_CHARS),
    rationale: z.string().trim().min(1).max(MAX_KNOWLEDGE_PROPOSAL_RATIONALE_CHARS),
    confidenceScore: z.number().min(0).max(1),
    confidenceLevel: knowledgeProposalConfidenceLevelSchema,
    evidence: z
      .array(z.string().trim().min(1).max(MAX_KNOWLEDGE_PROPOSAL_EVIDENCE_CHARS))
      .max(MAX_KNOWLEDGE_PROPOSAL_EVIDENCE_ITEMS)
      .default([]),
    existingContentHash: knowledgeContentHashSchema.optional(),
    proposedContent: z.string().trim().min(1).max(MAX_KNOWLEDGE_PROPOSAL_CONTENT_CHARS),
    conflictDetails: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "CONFLICT" && !value.conflictDetails) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conflictDetails"],
        message: "CONFLICT proposals must describe conflictDetails",
      });
    }
  });

export const knowledgeProposalDraftBatchSchema = z
  .array(knowledgeProposalDraftSchema)
  .max(MAX_KNOWLEDGE_PROPOSALS_PER_BATCH);

export const knowledgeIngestionBatchSchema = z
  .object({
    id: z.string().uuid(),
    knowledgeCategoryId: z.string().uuid(),
    specialistAgentId: z.string().uuid().nullable(),
    ingestionSkillId: z.string().uuid().nullable(),
    sourceFileName: z.string(),
    sourceMediaType: z.literal("text/markdown"),
    sourceContentHash: knowledgeContentHashSchema,
    baseVaultCommitSha: z.string().nullable(),
    status: knowledgeIngestionBatchStatusSchema,
    analysisExecutionId: z.string().uuid().nullable(),
    submittedAt: z.string().datetime().nullable(),
    committedAt: z.string().datetime().nullable(),
    vaultCommitSha: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const knowledgeProposalSchema = z
  .object({
    id: z.string().uuid(),
    batchId: z.string().uuid(),
    operation: knowledgeProposalOperationSchema,
    targetPath: knowledgePathSchema,
    targetHeading: z.string().nullable(),
    confidenceScore: z.number().min(0).max(1),
    confidenceLevel: knowledgeProposalConfidenceLevelSchema,
    title: z.string(),
    rationale: z.string(),
    evidence: z.array(z.string()),
    existingContentHash: knowledgeContentHashSchema.nullable(),
    proposedContent: z.string(),
    conflictDetails: z.string().nullable(),
    reviewStatus: knowledgeProposalReviewStatusSchema,
    reviewerNote: z.string().nullable(),
    appliedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const knowledgeIngestionBatchListResponseSchema = z.object({
  batches: z.array(knowledgeIngestionBatchSchema),
});

/**
 * Decision an operator may explicitly set on one proposal. `pending` is the initial
 * server-assigned state and is never an accepted client input.
 */
export const knowledgeProposalReviewDecisionSchema = z.enum(["approved", "denied", "needs_changes"]);

export const reviewKnowledgeProposalSchema = z
  .object({
    reviewStatus: knowledgeProposalReviewDecisionSchema,
    reviewerNote: z.string().trim().max(MAX_KNOWLEDGE_REVIEWER_NOTE_CHARS).nullable().optional(),
  })
  .strict();

/**
 * Deterministic computation of whether a batch's proposals are all in a submittable state.
 * `NO_CHANGE` proposals are never actionable and never block submission.
 */
export const knowledgeIngestionBatchReadinessSchema = z
  .object({
    ready: z.boolean(),
    totalProposals: z.number().int().nonnegative(),
    actionableProposals: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    needsChangesCount: z.number().int().nonnegative(),
    unresolvedConflictCount: z.number().int().nonnegative(),
    approvedCount: z.number().int().nonnegative(),
    deniedCount: z.number().int().nonnegative(),
    noChangeCount: z.number().int().nonnegative(),
    blockingReasons: z.array(z.string()),
  })
  .strict();

export const knowledgeIngestionBatchDetailResponseSchema = z.object({
  batch: knowledgeIngestionBatchSchema,
  proposals: z.array(knowledgeProposalSchema),
  readiness: knowledgeIngestionBatchReadinessSchema,
});

export const submitKnowledgeIngestionBatchResponseSchema = z.object({
  batch: knowledgeIngestionBatchSchema,
  appliedCount: z.number().int().nonnegative(),
  deniedCount: z.number().int().nonnegative(),
  noChangeCount: z.number().int().nonnegative(),
  commitSha: z.string().nullable(),
});

export type KnowledgeIngestionBatchStatus = z.infer<typeof knowledgeIngestionBatchStatusSchema>;
export type KnowledgeProposalOperation = z.infer<typeof knowledgeProposalOperationSchema>;
export type KnowledgeProposalConfidenceLevel = z.infer<typeof knowledgeProposalConfidenceLevelSchema>;
export type KnowledgeProposalReviewStatus = z.infer<typeof knowledgeProposalReviewStatusSchema>;
export type KnowledgeProposalReviewDecision = z.infer<typeof knowledgeProposalReviewDecisionSchema>;
export type ReviewKnowledgeProposal = z.infer<typeof reviewKnowledgeProposalSchema>;
export type CreateKnowledgeIngestionBatch = z.infer<typeof createKnowledgeIngestionBatchSchema>;
export type KnowledgeProposalDraft = z.infer<typeof knowledgeProposalDraftSchema>;
export type KnowledgeIngestionBatch = z.infer<typeof knowledgeIngestionBatchSchema>;
export type KnowledgeProposal = z.infer<typeof knowledgeProposalSchema>;
export type KnowledgeIngestionBatchListResponse = z.infer<typeof knowledgeIngestionBatchListResponseSchema>;
export type KnowledgeIngestionBatchReadiness = z.infer<typeof knowledgeIngestionBatchReadinessSchema>;
export type KnowledgeIngestionBatchDetailResponse = z.infer<typeof knowledgeIngestionBatchDetailResponseSchema>;
export type SubmitKnowledgeIngestionBatchResponse = z.infer<typeof submitKnowledgeIngestionBatchResponseSchema>;
