"use client";

import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  KnowledgeCategory,
  KnowledgeIngestionBatch,
  KnowledgeIngestionBatchDetailResponse,
  KnowledgeProposal,
  KnowledgeProposalReviewDecision,
} from "@orc/shared";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getKnowledgeCategoryFileContent,
  getKnowledgeIngestionBatch,
  getKnowledgeIngestionBatches,
  reviewKnowledgeProposal,
  submitKnowledgeIngestionBatch,
} from "@/lib/knowledge";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function operationVariant(operation: KnowledgeProposal["operation"]) {
  switch (operation) {
    case "CREATE":
      return "success" as const;
    case "UPDATE":
    case "MERGE":
      return "running" as const;
    case "CONFLICT":
      return "error" as const;
    default:
      return "outline" as const;
  }
}

function reviewStatusVariant(status: KnowledgeProposal["reviewStatus"]) {
  switch (status) {
    case "approved":
      return "success" as const;
    case "denied":
      return "error" as const;
    case "needs_changes":
      return "running" as const;
    default:
      return "outline" as const;
  }
}

function batchLabel(batch: KnowledgeIngestionBatch): string {
  return `${batch.sourceFileName} · ${batch.status} · ${new Date(batch.createdAt).toLocaleString()}`;
}

/** Human review queue: every specialist proposal gets an explicit Approve / Deny / Needs Changes decision. */
export function ReviewQueueTab({ category }: { category: KnowledgeCategory }) {
  const [batches, setBatches] = useState<KnowledgeIngestionBatch[]>([]);
  const [batchesStatus, setBatchesStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const [detail, setDetail] = useState<KnowledgeIngestionBatchDetailResponse | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const result = await getKnowledgeIngestionBatches(category.id);
      setBatches(result);
      setBatchesStatus("loaded");
      setSelectedBatchId((current) => current ?? result.at(-1)?.id ?? null);
    } catch (caught) {
      setBatchesStatus("error");
      setBatchesError(errorMessage(caught));
    }
  }, [category.id]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void loadBatches();
    });
    return () => {
      disposed = true;
    };
  }, [loadBatches]);

  const loadDetail = useCallback(async () => {
    if (!selectedBatchId) return;
    setDetailStatus("loading");
    setDetailError(null);
    try {
      const result = await getKnowledgeIngestionBatch(selectedBatchId);
      setDetail(result);
      setDetailStatus("loaded");
    } catch (caught) {
      setDetail(null);
      setDetailStatus("error");
      setDetailError(errorMessage(caught));
    }
  }, [selectedBatchId]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void loadDetail();
    });
    return () => {
      disposed = true;
    };
  }, [loadDetail]);

  const reviewableBatches = useMemo(
    () => batches.filter((batch) => batch.status !== "uploaded" && batch.status !== "analyzing"),
    [batches],
  );

  if (batchesStatus === "loading") {
    return (
      <Empty className="min-h-40 border border-border-default bg-surface-elevated">
        <Spinner className="size-5" />
        <EmptyTitle>Loading ingestion batches...</EmptyTitle>
      </Empty>
    );
  }

  if (batchesStatus === "error") {
    return (
      <Empty className="min-h-40 border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
            <AlertTriangleIcon />
          </EmptyMedia>
          <EmptyTitle>Could not load ingestion batches</EmptyTitle>
          <EmptyDescription>{batchesError}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (reviewableBatches.length === 0) {
    return (
      <Empty className="min-h-40 border border-border-default bg-surface-elevated">
        <EmptyTitle>Nothing to review yet</EmptyTitle>
        <EmptyDescription>Upload a source and run analysis from the Ingest tab first.</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-batch-select">Ingestion batch</Label>
        <NativeSelect
          id="review-batch-select"
          value={selectedBatchId ?? ""}
          onChange={(event) => setSelectedBatchId(event.target.value)}
          className="max-w-xl"
        >
          {reviewableBatches
            .slice()
            .reverse()
            .map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batchLabel(batch)}
              </option>
            ))}
        </NativeSelect>
      </div>

      {detailStatus === "loading" ? (
        <Empty className="min-h-40 border border-border-default bg-surface-elevated">
          <Spinner className="size-5" />
          <EmptyTitle>Loading batch...</EmptyTitle>
        </Empty>
      ) : null}

      {detailStatus === "error" ? (
        <Empty className="min-h-40 border border-border-default bg-surface-elevated">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>Could not load batch</EmptyTitle>
            <EmptyDescription>{detailError}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {detailStatus === "loaded" && detail ? (
        <BatchReview category={category} detail={detail} onChanged={() => void Promise.all([loadDetail(), loadBatches()])} />
      ) : null}
    </div>
  );
}

function BatchReview({
  category,
  detail,
  onChanged,
}: {
  category: KnowledgeCategory;
  detail: KnowledgeIngestionBatchDetailResponse;
  onChanged: () => void;
}) {
  const { batch, proposals, readiness } = detail;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ appliedCount: number; deniedCount: number; noChangeCount: number; commitSha: string | null } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitKnowledgeIngestionBatch(batch.id);
      setSubmitResult(result);
      onChanged();
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <span>
            {readiness.approvedCount} approved · {readiness.deniedCount} denied · {readiness.pendingCount} pending ·{" "}
            {readiness.needsChangesCount} needs changes · {readiness.noChangeCount} no change
          </span>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button type="button" disabled={!readiness.ready || submitting} onClick={() => setConfirmOpen(true)}>
            {batch.status === "committed" ? "Submitted" : submitting ? "Submitting..." : "Submit batch"}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit this batch?</AlertDialogTitle>
              <AlertDialogDescription>
                Approved proposals will be written to the vault and committed as one Git commit. Denied and
                no-change proposals will not be written.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Submitting..." : "Submit"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      {!readiness.ready && readiness.blockingReasons.length > 0 ? (
        <Empty className="min-h-0 items-start border border-border-default bg-surface-elevated p-4 text-start">
          <EmptyHeader className="items-start text-start">
            <EmptyMedia variant="icon" className="bg-status-warning/10 text-status-warning">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>Not ready to submit</EmptyTitle>
            <EmptyDescription>
              <ul className="list-disc space-y-0.5 ps-4">
                {readiness.blockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {submitError ? <p className="text-sm text-status-error">{submitError}</p> : null}

      {submitResult ? (
        <Empty className="min-h-0 items-start border border-status-success/30 bg-status-success/5 p-4 text-start">
          <EmptyHeader className="items-start text-start">
            <EmptyMedia variant="icon" className="bg-status-success/10 text-status-success">
              <CheckCircle2Icon />
            </EmptyMedia>
            <EmptyTitle>Batch submitted</EmptyTitle>
            <EmptyDescription>
              Applied {submitResult.appliedCount}, denied {submitResult.deniedCount}, no change{" "}
              {submitResult.noChangeCount}.{" "}
              {submitResult.commitSha ? <span className="font-mono text-xs">{submitResult.commitSha}</span> : null}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {batch.failureReason ? <p className="text-sm text-status-error">{batch.failureReason}</p> : null}

      <ul className="flex flex-col gap-3">
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} category={category} proposal={proposal} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

const decisionOptions: { value: KnowledgeProposalReviewDecision; label: string }[] = [
  { value: "approved", label: "Approve" },
  { value: "denied", label: "Deny" },
  { value: "needs_changes", label: "Needs changes" },
];

function ProposalCard({
  category,
  proposal,
  onChanged,
}: {
  category: KnowledgeCategory;
  proposal: KnowledgeProposal;
  onChanged: () => void;
}) {
  const [note, setNote] = useState(proposal.reviewerNote ?? "");
  const [saving, setSaving] = useState<KnowledgeProposalReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [existingContent, setExistingContent] = useState<string | null | "loading">(null);
  const locked = proposal.appliedAt !== null;

  async function decide(decision: KnowledgeProposalReviewDecision) {
    setSaving(decision);
    setError(null);
    try {
      await reviewKnowledgeProposal(proposal.batchId, proposal.id, {
        reviewStatus: decision,
        reviewerNote: note.trim().length > 0 ? note.trim() : null,
      });
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(null);
    }
  }

  async function toggleDiff() {
    const next = !showDiff;
    setShowDiff(next);
    if (next && existingContent === null) {
      setExistingContent("loading");
      try {
        const result = await getKnowledgeCategoryFileContent(category.id, proposal.targetPath);
        setExistingContent(result.status === "ok" ? (result.content ?? "(not found)") : "(not found)");
      } catch {
        setExistingContent("(unable to load)");
      }
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={operationVariant(proposal.operation)} label={proposal.operation} entityLabel="Operation" />
        <StatusBadge variant={reviewStatusVariant(proposal.reviewStatus)} label={proposal.reviewStatus.replace("_", " ")} entityLabel="Review" />
        <span className="font-mono text-xs text-text-muted">{proposal.targetPath}</span>
        {proposal.targetHeading ? <span className="text-xs text-text-muted">§ {proposal.targetHeading}</span> : null}
        <span className="ms-auto text-xs text-text-muted">
          Confidence: {proposal.confidenceLevel} ({Math.round(proposal.confidenceScore * 100)}%)
        </span>
      </div>

      <h3 className="text-sm font-medium text-text-primary">{proposal.title}</h3>
      <p className="text-sm text-text-secondary">{proposal.rationale}</p>

      {proposal.conflictDetails ? (
        <p className="rounded-md bg-status-error/10 p-2 text-sm text-status-error">{proposal.conflictDetails}</p>
      ) : null}

      {proposal.evidence.length > 0 ? (
        <ul className="list-disc space-y-0.5 ps-4 text-xs text-text-muted">
          {proposal.evidence.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : null}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => void toggleDiff()}>
          {showDiff ? "Hide diff" : "Show existing vs proposed"}
        </Button>

        {showDiff ? (
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0 overflow-hidden rounded-md border border-border-default">
              <div className="border-b border-divider bg-surface-interactive/30 px-2 py-1 text-xs font-medium text-text-muted">
                Existing
              </div>
              <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap p-2 text-xs text-text-secondary">
                {existingContent === "loading" ? "Loading..." : existingContent ?? "(no existing content)"}
              </pre>
            </div>
            <div className="min-w-0 overflow-hidden rounded-md border border-border-default">
              <div className="border-b border-divider bg-surface-interactive/30 px-2 py-1 text-xs font-medium text-text-muted">
                Proposed
              </div>
              <pre className="max-h-64 min-w-0 overflow-auto whitespace-pre-wrap p-2 text-xs text-text-secondary">
                {proposal.proposedContent}
              </pre>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`note-${proposal.id}`}>Reviewer note</Label>
        <Textarea
          id={`note-${proposal.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={locked}
          className="min-h-16 text-xs"
        />
      </div>

      {error ? <p className="text-sm text-status-error">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {decisionOptions.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={proposal.reviewStatus === option.value ? "default" : "outline"}
            disabled={locked || saving !== null}
            className={cn(proposal.reviewStatus === option.value && "pointer-events-none")}
            onClick={() => void decide(option.value)}
          >
            {saving === option.value ? "Saving..." : option.label}
          </Button>
        ))}
      </div>
    </li>
  );
}
