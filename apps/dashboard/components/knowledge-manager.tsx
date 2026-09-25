"use client";

import {
  AlertTriangleIcon,
  BookOpenIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  RefreshCwIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Agent, KnowledgeCategory, Skill } from "@orc/shared";

import { KnowledgeConfigDrawer } from "@/components/knowledge-config-drawer";
import { DataTable, type DataTableColumn } from "@/components/patterns/data-table";
import { RowActionsMenu } from "@/components/patterns/row-actions-menu";
import { SearchInput } from "@/components/patterns/search-input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { getKnowledgeCategories, updateKnowledgeCategory } from "@/lib/knowledge";
import { getAgents } from "@/lib/agents";
import { getSkills } from "@/lib/skills";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Knowledge Categories";
}

/** Renders the Knowledge Category catalog: browse, create, and edit configured categories. */
export function KnowledgeManager() {
  const router = useRouter();
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, nextAgents, nextSkills] = await Promise.all([getKnowledgeCategories(), getAgents(), getSkills()]);
      setCategories(next); setAgents(nextAgents); setSkills(nextSkills);
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
  const specialistName = (item: KnowledgeCategory) => agents.find((agent) => agent.id === item.specialistAgentId)?.name ?? "Not configured";
  const skillName = (item: KnowledgeCategory) => skills.find((skill) => skill.id === item.ingestionSkillId)?.name ?? "Not configured";

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

  async function toggleEnabled(item: KnowledgeCategory) {
    try {
      await updateKnowledgeCategory(item.id, { enabled: !item.enabled });
      await load();
    } catch (caught) {
      console.error(errorMessage(caught));
    }
  }

  const categoryColumns: DataTableColumn<KnowledgeCategory>[] = [
    {
      key: "category",
      header: "Category",
      render: (item) => (
        <Link href={`/knowledge/${item.id}`} className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-brand-accent">
            <BookOpenIcon className="size-4" />
          </div>
          <div>
            <div className="font-medium text-text-primary">{item.name}</div>
            <div className="font-mono text-[11px] text-text-muted">{item.slug}</div>
          </div>
        </Link>
      ),
    },
    {
      key: "vault",
      header: "Vault directory",
      className: "max-w-64 font-mono text-sm text-text-secondary",
      render: (item) => (
        <span className="block truncate" title={item.vaultRootPath}>
          {item.vaultRootPath}
        </span>
      ),
    },
    {
      key: "ingestion",
      header: "Ingestion",
      className: "text-sm",
      render: (item) => {
        const specialist = specialistName(item);
        const skill = skillName(item);
        const notConfigured = specialist === "Not configured" || skill === "Not configured";

        return (
          <>
            <div className="flex items-center gap-1.5">
              {notConfigured ? (
                <AlertTriangleIcon
                  className="size-3.5 shrink-0 text-status-warning"
                  aria-hidden="true"
                />
              ) : null}
              <span className={cn(specialist === "Not configured" && "text-status-warning")}>
                {specialist}
              </span>
            </div>
            <div
              className={cn(
                "text-xs text-text-muted",
                skill === "Not configured" && "text-status-warning",
              )}
            >
              {skill}
            </div>
          </>
        );
      },
    },
    { key: "updated", header: "Updated", className: "text-xs text-text-muted", render: (item) => formatUpdatedAt(item.updatedAt) },
    {
      key: "status",
      header: "Status",
      render: (item) => <StatusBadge variant={item.enabled ? "success" : "disabled"} label={item.enabled ? "Enabled" : "Disabled"} entityLabel="Category" />,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <RowActionsMenu
            label={`Actions for ${item.name}`}
            items={[
              { label: "Edit Category", icon: <PencilIcon />, onClick: () => openEdit(item.id) },
              {
                label: item.enabled ? "Disable Category" : "Enable Category",
                icon: <PowerIcon />,
                onClick: () => void toggleEnabled(item),
              },
            ]}
          />
        </div>
      ),
    },
  ];

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
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search Knowledge Categories..."
            aria-label="Search Knowledge Categories"
            disabled={status !== "loaded"}
          />
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
          <DataTable
            className="min-w-[720px]"
            columns={categoryColumns}
            rows={visibleCategories}
            getRowKey={(item) => item.id}
            onRowClick={(item) => router.push(`/knowledge/${item.id}`)}
          />
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
        agents={agents}
        skills={skills}
        onOpenChange={setDrawerOpen}
        onRefresh={load}
      />
    </div>
  );
}
