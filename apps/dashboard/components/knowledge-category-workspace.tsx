"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Agent,
  KnowledgeCategory,
  KnowledgeCategoryFile,
  KnowledgeCategoryFileContentResponse,
  KnowledgeIngestionBatch,
} from "@orc/shared";
import type { Skill } from "@orc/shared";

import { SearchInput } from "@/components/patterns/search-input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createKnowledgeIngestionBatch,
  getKnowledgeCategory,
  getKnowledgeCategoryFileContent,
  getKnowledgeCategoryFiles,
  getKnowledgeIngestionBatches,
  startKnowledgeIngestionAnalysis,
} from "@/lib/knowledge";
import { getAgents } from "@/lib/agents";
import { getSkills } from "@/lib/skills";
import { ReviewQueueTab } from "@/components/knowledge-review-queue";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Knowledge Category";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const KNOWLEDGE_WORKSPACE_TABS = ["vault-files", "ingest", "review-queue"] as const;
type KnowledgeWorkspaceTab = (typeof KNOWLEDGE_WORKSPACE_TABS)[number];

function isKnowledgeWorkspaceTab(value: string | null): value is KnowledgeWorkspaceTab {
  return KNOWLEDGE_WORKSPACE_TABS.includes(value as KnowledgeWorkspaceTab);
}

/** Loads one Knowledge Category and renders its read-only vault browsing workspace. */
export function KnowledgeCategoryWorkspace({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = isKnowledgeWorkspaceTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as KnowledgeWorkspaceTab)
    : "vault-files";

  const [category, setCategory] = useState<KnowledgeCategory | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const requestRef = useRef<AbortController | null>(null);

  const loadCategory = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setError(null);

    try {
      const next = await getKnowledgeCategory(categoryId, controller.signal);
      if (controller.signal.aborted) return;
      setCategory(next);
      const [nextAgents, nextSkills] = await Promise.all([getAgents(), getSkills()]);
      if (controller.signal.aborted) return;
      setAgents(nextAgents); setSkills(nextSkills);
      setStatus("loaded");
    } catch (caught) {
      if (isAbortError(caught)) return;
      setCategory(null);
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [categoryId]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void loadCategory();
    });
    return () => {
      disposed = true;
      requestRef.current?.abort();
    };
  }, [loadCategory]);

  if (status === "loading" && !category) {
    return (
      <Workspace>
        <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
          <Spinner className="size-6" />
          <EmptyTitle>Loading Knowledge Category...</EmptyTitle>
        </Empty>
      </Workspace>
    );
  }

  if (status === "error" || !category) {
    return (
      <Workspace>
        <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>Failed to load Knowledge Category</EmptyTitle>
            <EmptyDescription>{error ?? "Could not reach the backend."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Workspace>
    );
  }

  return (
    <Workspace>
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">{category.name}</h1>
          <StatusBadge variant={category.enabled ? "success" : "disabled"} label={category.enabled ? "Enabled" : "Disabled"} entityLabel="Category" />
        </div>
        <p className="text-sm text-text-muted">
          {category.description || "No description."} Vault directory:{" "}
          <span className="font-mono text-text-secondary">{category.vaultRootPath}</span>
        </p>
        <p className="text-sm text-text-muted">Specialist: <span className="text-text-secondary">{agents.find((agent) => agent.id === category.specialistAgentId)?.name ?? "Not configured"}</span> · Ingestion Skill: <span className="text-text-secondary">{skills.find((skill) => skill.id === category.ingestionSkillId)?.name ?? "Not configured"}</span></p>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", value);
          router.replace(`/knowledge/${categoryId}?${params.toString()}`, { scroll: false });
        }}
      >
        <TabsList>
          <TabsTrigger value="vault-files">Vault Files</TabsTrigger>
          <TabsTrigger value="ingest">Ingest</TabsTrigger>
          <TabsTrigger value="review-queue">Review Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="vault-files">
          <VaultFilesTab category={category} />
        </TabsContent>
        <TabsContent value="ingest">
          <IngestTab category={category} />
        </TabsContent>
        <TabsContent value="review-queue">
          <ReviewQueueTab category={category} />
        </TabsContent>
      </Tabs>
    </Workspace>
  );
}

function Workspace({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <Button variant="ghost" size="sm" render={<Link href="/knowledge" />} className="w-fit">
        <ArrowLeftIcon />
        Knowledge
      </Button>
      {children}
    </div>
  );
}

/** Browses the read-only Markdown files mapped to one Knowledge Category. */
function VaultFilesTab({ category }: { category: KnowledgeCategory }) {
  const [files, setFiles] = useState<KnowledgeCategoryFile[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<KnowledgeCategoryFileContentResponse | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fileQuery, setFileQuery] = useState("");

  const loadFiles = useCallback(async () => {
    try {
      const result = await getKnowledgeCategoryFiles(category.id);
      setFiles(result.files);
      setListStatus(result.status === "ok" ? "loaded" : "error");
      setListMessage(result.status === "ok" ? null : result.message ?? "The knowledge vault is unavailable.");
    } catch (caught) {
      setFiles([]);
      setListStatus("error");
      setListMessage(errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  }, [category.id]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void loadFiles();
    });
    return () => {
      disposed = true;
    };
  }, [loadFiles]);

  const openFile = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      setPreviewStatus("loading");
      setPreviewError(null);
      try {
        const result = await getKnowledgeCategoryFileContent(category.id, path);
        setPreview(result);
        setPreviewStatus(result.status === "ok" ? "loaded" : "error");
        if (result.status !== "ok") {
          setPreviewError(result.message ?? "This file could not be read.");
        }
      } catch (caught) {
        setPreview(null);
        setPreviewStatus("error");
        setPreviewError(errorMessage(caught));
      }
    },
    [category.id],
  );

  function refresh() {
    setRefreshing(true);
    void loadFiles();
  }

  const visibleFiles = useMemo(() => {
    const normalized = fileQuery.trim().toLowerCase();
    if (!normalized) return files;
    return files.filter((file) => file.name.toLowerCase().includes(normalized));
  }, [files, fileQuery]);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between border-b border-divider p-3">
          <h2 className="text-sm font-medium text-text-primary">Files</h2>
          <Button type="button" variant="outline" size="icon-sm" onClick={refresh} disabled={refreshing} aria-label="Refresh vault files">
            <RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </Button>
        </div>

        {listStatus === "loaded" && files.length > 0 ? (
          <div className="border-b border-divider p-2">
            <SearchInput
              value={fileQuery}
              onChange={setFileQuery}
              placeholder="Search files..."
              aria-label="Search vault files"
            />
          </div>
        ) : null}

        {listStatus === "loading" ? (
          <Empty className="min-h-40 rounded-none border-0">
            <Spinner className="size-5" />
            <EmptyTitle>Loading files...</EmptyTitle>
          </Empty>
        ) : null}

        {listStatus === "error" ? (
          <Empty className="min-h-40 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
                <AlertTriangleIcon />
              </EmptyMedia>
              <EmptyTitle>Vault unavailable</EmptyTitle>
              <EmptyDescription>{listMessage}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {listStatus === "loaded" && files.length === 0 ? (
          <Empty className="min-h-40 rounded-none border-0">
            <EmptyTitle>No files found</EmptyTitle>
            <EmptyDescription>No Markdown files exist yet under this category&apos;s vault directory.</EmptyDescription>
          </Empty>
        ) : null}

        {listStatus === "loaded" && files.length > 0 && visibleFiles.length === 0 ? (
          <Empty className="min-h-40 rounded-none border-0">
            <EmptyTitle>No matching files</EmptyTitle>
            <EmptyDescription>No file name matches your search.</EmptyDescription>
          </Empty>
        ) : null}

        {listStatus === "loaded" && visibleFiles.length > 0 ? (
          <ul className="divide-y divide-divider">
            {visibleFiles.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => void openFile(file.path)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-interactive/45",
                    selectedPath === file.path && "bg-surface-interactive/60 font-medium text-text-primary",
                  )}
                >
                  <FileTextIcon className="size-4 shrink-0 text-text-muted" />
                  <span className="truncate">{file.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        {!selectedPath ? (
          <Empty className="min-h-40 rounded-none border-0">
            <EmptyTitle>Select a file</EmptyTitle>
            <EmptyDescription>Choose a Markdown file to preview its content.</EmptyDescription>
          </Empty>
        ) : null}

        {selectedPath && previewStatus === "loading" ? (
          <Empty className="min-h-40 rounded-none border-0">
            <Spinner className="size-5" />
            <EmptyTitle>Loading preview...</EmptyTitle>
          </Empty>
        ) : null}

        {selectedPath && previewStatus === "error" ? (
          <Empty className="min-h-40 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
                <AlertTriangleIcon />
              </EmptyMedia>
              <EmptyTitle>Could not load file</EmptyTitle>
              <EmptyDescription>{previewError}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {selectedPath && previewStatus === "loaded" && preview?.status === "ok" ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-divider p-3">
              <div className="font-mono text-xs text-text-muted">{preview.path}</div>
            </div>
            <pre className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap p-4 text-sm text-text-primary">
              {preview.content}
            </pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Copies a full identifier to the clipboard and briefly confirms the copy. */
function CopyIdentifierButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable (permissions, non-secure context); no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy ${label}`}
      className="inline-flex size-4 items-center justify-center text-text-muted hover:text-text-primary"
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </button>
  );
}

function batchStatusVariant(status: KnowledgeIngestionBatch["status"]) {
  switch (status) {
    case "committed":
      return "success" as const;
    case "review_ready":
      return "running" as const;
    case "analyzing":
    case "submitting":
      return "neutral" as const;
    case "failed":
      return "error" as const;
    default:
      return "outline" as const;
  }
}

function batchStatusLabel(status: KnowledgeIngestionBatch["status"]): string {
  switch (status) {
    case "review_ready":
      return "Review ready";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/** Uploads a prepared Markdown knowledge source and tracks its specialist analysis. */
function IngestTab({ category }: { category: KnowledgeCategory }) {
  const ready = Boolean(category.specialistAgentId && category.ingestionSkillId && category.enabled);

  const [fileName, setFileName] = useState("knowledge.md");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [batches, setBatches] = useState<KnowledgeIngestionBatch[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  const loadBatches = useCallback(async () => {
    try {
      const result = await getKnowledgeIngestionBatches(category.id);
      setBatches(result);
      setListStatus("loaded");
    } catch (caught) {
      setListStatus("error");
      setListError(errorMessage(caught));
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

  const fileNameIsValid = fileName.trim().toLowerCase().endsWith(".md");

  async function uploadSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!ready) {
      setSubmitError("Configure an enabled specialist Agent and ingestion Skill before uploading a source.");
      return;
    }

    if (!fileNameIsValid) {
      setSubmitError("Source file name must end with .md");
      return;
    }

    if (content.trim().length === 0) {
      setSubmitError("Source content must not be blank");
      return;
    }

    setSubmitting(true);

    try {
      await createKnowledgeIngestionBatch(category.id, {
        sourceFileName: fileName.trim(),
        sourceMediaType: "text/markdown",
        sourceContent: content,
      });
      setContent("");
      await loadBatches();
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function analyze(batchId: string) {
    setAnalyzingIds((current) => new Set(current).add(batchId));

    try {
      await startKnowledgeIngestionAnalysis(batchId);
      await loadBatches();
    } catch (caught) {
      setListError(errorMessage(caught));
    } finally {
      setAnalyzingIds((current) => {
        const next = new Set(current);
        next.delete(batchId);
        return next;
      });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!ready ? (
        <Empty className="border border-border-default bg-surface-elevated">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-status-warning/10 text-status-warning">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>No specialist configured</EmptyTitle>
            <EmptyDescription>
              Configure an enabled specialist Agent and ingestion Skill for this category before uploading a
              source.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <form
        onSubmit={(event) => void uploadSource(event)}
        className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated p-4 shadow-xs"
      >
        <h2 className="text-sm font-medium text-text-primary">Upload knowledge source</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-file-name">File name</Label>
          <Input
            id="ingest-file-name"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="knowledge.md"
            aria-invalid={fileName.trim().length > 0 && !fileNameIsValid}
          />
          {fileName.trim().length > 0 && !fileNameIsValid ? (
            <p className="text-sm text-status-error">Source file name must end with .md</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-content">Markdown content</Label>
          <Textarea
            id="ingest-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste prepared Markdown knowledge here..."
            className="min-h-40 font-mono text-xs"
          />
        </div>

        {submitError ? <p className="text-sm text-status-error">{submitError}</p> : null}

        <Button type="submit" disabled={submitting || !ready} className="w-fit">
          <UploadIcon />
          {submitting ? "Uploading..." : "Upload source"}
        </Button>
      </form>

      <section className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between border-b border-divider p-3">
          <h2 className="text-sm font-medium text-text-primary">Ingestion batches</h2>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => void loadBatches()}
            aria-label="Refresh ingestion batches"
          >
            <RefreshCwIcon />
          </Button>
        </div>

        {listStatus === "loading" ? (
          <Empty className="min-h-32 rounded-none border-0">
            <Spinner className="size-5" />
            <EmptyTitle>Loading batches...</EmptyTitle>
          </Empty>
        ) : null}

        {listStatus === "error" ? (
          <Empty className="min-h-32 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
                <AlertTriangleIcon />
              </EmptyMedia>
              <EmptyTitle>Could not load ingestion batches</EmptyTitle>
              <EmptyDescription>{listError}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {listStatus === "loaded" && batches.length === 0 ? (
          <Empty className="min-h-32 rounded-none border-0">
            <EmptyTitle>No ingestion batches yet</EmptyTitle>
            <EmptyDescription>Upload a Markdown source above to start one.</EmptyDescription>
          </Empty>
        ) : null}

        {listStatus === "loaded" && batches.length > 0 ? (
          <ul className="divide-y divide-divider">
            {batches.map((batch) => (
              <li key={batch.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-text-primary">{batch.sourceFileName}</span>
                  <span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
                    {batch.sourceContentHash.slice(0, 12)}
                    <CopyIdentifierButton value={batch.sourceContentHash} label="content hash" />
                  </span>
                  {batch.status === "committed" && batch.vaultCommitSha ? (
                    <span className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
                      Commit <span className="text-text-secondary">{batch.vaultCommitSha.slice(0, 12)}</span>
                      <CopyIdentifierButton value={batch.vaultCommitSha} label="commit SHA" />
                      {batch.committedAt ? ` · ${new Date(batch.committedAt).toLocaleString()}` : null}
                    </span>
                  ) : null}
                  {batch.failureReason ? (
                    <span className="text-xs text-status-error">{batch.failureReason}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge variant={batchStatusVariant(batch.status)} label={batchStatusLabel(batch.status)} entityLabel="Batch" />
                  {batch.status === "uploaded" || batch.status === "failed" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={analyzingIds.has(batch.id) || !ready}
                      onClick={() => void analyze(batch.id)}
                    >
                      {analyzingIds.has(batch.id) ? "Starting..." : batch.status === "failed" ? "Retry" : "Analyze"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
