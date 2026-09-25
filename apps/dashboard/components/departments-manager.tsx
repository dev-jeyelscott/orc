"use client";

import {
  Building2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Department } from "@orc/shared";

import { DepartmentConfigDrawer } from "@/components/department-config-drawer";
import { DataTable, type DataTableColumn } from "@/components/patterns/data-table";
import { ListEmptyState } from "@/components/patterns/empty-state";
import { FilterSelect } from "@/components/patterns/filter-select";
import { SearchInput } from "@/components/patterns/search-input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { getDepartments } from "@/lib/departments";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Departments";
}

/** Renders the independent Department management registry. */
export function DepartmentsManager() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [departmentId, setDepartmentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getDepartments();
      setDepartments(next); setStatus("loaded"); setError(null);
    } catch (caught) { setError(errorMessage(caught)); setStatus("error"); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void load();
    });
    return () => { disposed = true; };
  }, [load]);

  const visibleDepartments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return departments.filter((department) => {
      const matchingStatus = enabledFilter === "all" || (enabledFilter === "enabled" ? department.enabled : !department.enabled);
      const haystack = `${department.name} ${department.slug} ${department.role} ${department.harness} ${department.defaultModel} ${department.defaultReasoning}`.toLowerCase();
      return matchingStatus && (!normalized || haystack.includes(normalized));
    });
  }, [departments, enabledFilter, query]);

  const department = departments.find((item) => item.id === departmentId) ?? null;
  function openCreate() { setDepartmentId(null); setDrawerMode("create"); setDrawerOpen(true); }
  function openEdit(id: string) { setDepartmentId(id); setDrawerMode("edit"); setDrawerOpen(true); }
  function refresh() { setRefreshing(true); void load(); }

  const departmentColumns: DataTableColumn<Department>[] = [
    { key: "department", header: "Department", render: (item) => <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-brand-accent"><Building2Icon className="size-4" /></div><div><div className="font-medium text-text-primary">{item.name}</div><div className="font-mono text-[11px] text-text-muted">{item.slug}</div></div></div> },
    { key: "role", header: "Role", className: "text-sm text-text-secondary", render: (item) => item.role },
    { key: "runtime", header: "Runtime defaults", render: (item) => <><div className="text-sm text-text-secondary">{item.harness} · {item.defaultModel}</div><div className="text-xs text-text-muted">{item.defaultReasoning}</div></> },
    { key: "agents", header: "Agents", className: "font-mono text-sm text-text-secondary", render: (item) => item.agentCount },
    { key: "updated", header: "Updated", className: "text-xs text-text-muted", render: (item) => formatUpdatedAt(item.updatedAt) },
    { key: "status", header: "Status", render: (item) => <StatusBadge variant={item.enabled ? "success" : "disabled"} label={item.enabled ? "Enabled" : "Disabled"} /> },
    { key: "actions", header: <span className="sr-only">Actions</span>, className: "text-right", render: (item) => <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${item.name}`} onClick={() => openEdit(item.id)}><PencilIcon /></Button> },
  ];

  return <div className="flex min-w-0 flex-1 flex-col gap-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-heading text-2xl font-semibold text-text-primary">Departments</h1><p className="mt-1 text-sm text-text-muted">Manage reusable Agent role, runtime, and permission defaults.</p></div><Button type="button" onClick={openCreate}><PlusIcon />Create Department</Button></header>
    <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs" aria-label="Departments browser">
      <div className="flex flex-wrap items-center gap-3 border-b border-divider p-3"><SearchInput value={query} onChange={setQuery} placeholder="Search Departments..." aria-label="Search Departments" disabled={status !== "loaded"} /><FilterSelect options={[{ value: "all", label: "All statuses" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]} value={enabledFilter} onChange={(value) => setEnabledFilter(value as typeof enabledFilter)} disabled={status !== "loaded"} aria-label="Filter Departments by status" /><Button type="button" variant="outline" onClick={refresh} disabled={refreshing}><RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />Refresh</Button></div>
      {status === "loading" ? <ListEmptyState variant="loading" title="Loading Departments..." /> : null}
      {status === "error" ? <ListEmptyState variant="error" title="Failed to load Departments" description={error ?? "Could not reach the backend."} onRetry={() => void load()} /> : null}
      {status === "loaded" && departments.length === 0 ? <ListEmptyState variant="empty" icon={<Building2Icon />} title="No Departments found" description="Create a Department to establish reusable defaults for future Agents." action={<Button type="button" size="sm" onClick={openCreate}><PlusIcon />Create Department</Button>} /> : null}
      {status === "loaded" && departments.length > 0 && visibleDepartments.length === 0 ? <ListEmptyState variant="empty" title="No matching Departments" description="No Department matches the current search and status filter." className="min-h-64" /> : null}
      {status === "loaded" && visibleDepartments.length > 0 ? <DataTable className="min-w-[850px]" columns={departmentColumns} rows={visibleDepartments} getRowKey={(item) => item.id} /> : null}
      {status === "loaded" ? <footer className="border-t border-divider bg-surface-interactive/30 px-4 py-2.5 text-xs text-text-muted">Showing {visibleDepartments.length} of {departments.length} {departments.length === 1 ? "Department" : "Departments"}</footer> : null}
    </section>
    <DepartmentConfigDrawer key={`${drawerMode}:${department?.id ?? "new"}`} open={drawerOpen} mode={drawerMode} department={department} onOpenChange={setDrawerOpen} onRefresh={load} />
  </div>;
}
