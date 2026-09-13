"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  FileTextIcon,
  RefreshCwIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  KnowledgeCategory,
  KnowledgeCategoryFile,
  KnowledgeCategoryFileContentResponse,
} from "@orc/shared";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import {
  getKnowledgeCategory,
  getKnowledgeCategoryFileContent,
  getKnowledgeCategoryFiles,
} from "@/lib/knowledge";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Knowledge Category";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Loads one Knowledge Category and renders its read-only vault browsing workspace. */
export function KnowledgeCategoryWorkspace({ categoryId }: { categoryId: string }) {
  const [category, setCategory] = useState<KnowledgeCategory | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
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
          <Badge variant={category.enabled ? "success" : "disabled"}>
            {category.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <p className="text-sm text-text-muted">
          {category.description || "No description."} Vault directory:{" "}
          <span className="font-mono text-text-secondary">{category.vaultRootPath}</span>
        </p>
      </header>

      <Tabs defaultValue="vault-files">
        <TabsList>
          <TabsTrigger value="vault-files">Vault Files</TabsTrigger>
        </TabsList>
        <TabsContent value="vault-files">
          <VaultFilesTab category={category} />
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

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
        <div className="flex items-center justify-between border-b border-divider p-3">
          <h2 className="text-sm font-medium text-text-primary">Files</h2>
          <Button type="button" variant="outline" size="icon-sm" onClick={refresh} disabled={refreshing} aria-label="Refresh vault files">
            <RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
          </Button>
        </div>

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

        {listStatus === "loaded" && files.length > 0 ? (
          <ul className="divide-y divide-divider">
            {files.map((file) => (
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
