"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { KnowledgeCategory } from "@orc/shared";

import { KnowledgeConfigDrawer } from "@/components/knowledge-config-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getKnowledgeCategories } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Knowledge Categories";
}

/** Renders the Knowledge Category catalog: browse, create, and edit configured categories. */
export function KnowledgeManager() {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getKnowledgeCategories();
      setCategories(next);
      setStatus("loaded");
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void load();
    });
    return () => {
      disposed = true;
    };
  }, [load]);

  const visibleCategories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return categories;
    return categories.filter((category) => {
      const haystack = `${category.name} ${category.slug} ${category.vaultRootPath}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [categories, query]);

  const category = categories.find((item) => item.id === categoryId) ?? null;

  function openCreate() {
    setCategoryId(null);
    setDrawerMode("create");
    setDrawerOpen(true);
  }

  function openEdit(id: string) {
    setCategoryId(id);
    setDrawerMode("edit");
    setDrawerOpen(true);
  }

  function refresh() {
    setRefreshing(true);
    void load();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Knowledge</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage durable Knowledge Categories and browse their canonical vault notes.
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <PlusIcon />
          Create Category
        </Button>
      </header>

      <section
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
        aria-label="Knowledge Categories browser"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-divider p-3">
          <InputGroup className="min-w-56 flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Knowledge Categories..."
              aria-label="Search Knowledge Categories"
              disabled={status !== "loaded"}
            />
          </InputGroup>
          <Button type="button" variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
            Refresh
          </Button>
        </div>

        {status === "loading" ? (
          <Empty className="min-h-80 rounded-none border-0">
            <Spinner className="size-6" />
            <EmptyTitle>Loading Knowledge Categories...</EmptyTitle>
          </Empty>
        ) : null}

        {status === "error" ? (
          <Empty className="min-h-80 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
                <AlertTriangleIcon />
              </EmptyMedia>
              <EmptyTitle>Failed to load Knowledge Categories</EmptyTitle>
              <EmptyDescription>{error ?? "Could not reach the backend."}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="destructive" onClick={() => void load()}>
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {status === "loaded" && categories.length === 0 ? (
          <Empty className="min-h-80 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>No Knowledge Categories found</EmptyTitle>
              <EmptyDescription>
                Create a category to map a durable knowledge domain to a vault directory.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" onClick={openCreate}>
                <PlusIcon />
                Create Category
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {status === "loaded" && categories.length > 0 && visibleCategories.length === 0 ? (
          <Empty className="min-h-64 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>No matching Knowledge Categories</EmptyTitle>
              <EmptyDescription>No category matches the current search.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {status === "loaded" && visibleCategories.length > 0 ? (
          <Table className="min-w-[720px]">
            <TableHeader className="bg-surface-interactive/45">
              <TableRow className="hover:bg-transparent">
                <TableHead>Category</TableHead>
                <TableHead>Vault directory</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCategories.map((item) => (
                <TableRow key={item.id} className="h-16 border-divider hover:bg-surface-interactive/45">
                  <TableCell>
                    <Link href={`/knowledge/${item.id}`} className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-brand-accent">
                        <BookOpenIcon className="size-4" />
                      </div>
                      <div>
                        <div className="font-medium text-text-primary">{item.name}</div>
                        <div className="font-mono text-[11px] text-text-muted">{item.slug}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-text-secondary">{item.vaultRootPath}</TableCell>
                  <TableCell className="text-xs text-text-muted">{formatUpdatedAt(item.updatedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={item.enabled ? "success" : "disabled"}>
                      {item.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} />}
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(item.id)}>
                          <PencilIcon />
                          Edit Category
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {status === "loaded" ? (
          <footer className="border-t border-divider bg-surface-interactive/30 px-4 py-2.5 text-xs text-text-muted">
            Showing {visibleCategories.length} of {categories.length}{" "}
            {categories.length === 1 ? "Category" : "Categories"}
          </footer>
        ) : null}
      </section>

      <KnowledgeConfigDrawer
        key={`${drawerMode}:${category?.id ?? "new"}`}
        open={drawerOpen}
        mode={drawerMode}
        category={category}
        onOpenChange={setDrawerOpen}
        onRefresh={load}
      />
    </div>
  );
}
