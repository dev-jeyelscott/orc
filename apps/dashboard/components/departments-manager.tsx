"use client";

import {
  AlertTriangleIcon,
  Building2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Department } from "@orc/shared";

import { DepartmentConfigDrawer } from "@/components/department-config-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  return <div className="flex min-w-0 flex-1 flex-col gap-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-heading text-2xl font-semibold text-text-primary">Departments</h1><p className="mt-1 text-sm text-text-muted">Manage reusable Agent role, runtime, and permission defaults.</p></div><Button type="button" onClick={openCreate}><PlusIcon />Create Department</Button></header>
    <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs" aria-label="Departments browser">
      <div className="flex flex-wrap items-center gap-3 border-b border-divider p-3"><InputGroup className="min-w-56 flex-1"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Departments..." aria-label="Search Departments" disabled={status !== "loaded"} /></InputGroup><NativeSelect className="w-36" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value as typeof enabledFilter)} disabled={status !== "loaded"} aria-label="Filter Departments by status"><NativeSelectOption value="all">All statuses</NativeSelectOption><NativeSelectOption value="enabled">Enabled</NativeSelectOption><NativeSelectOption value="disabled">Disabled</NativeSelectOption></NativeSelect><Button type="button" variant="outline" onClick={refresh} disabled={refreshing}><RefreshCwIcon className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />Refresh</Button></div>
      {status === "loading" ? <Empty className="min-h-80 rounded-none border-0"><Spinner className="size-6" /><EmptyTitle>Loading Departments...</EmptyTitle></Empty> : null}
      {status === "error" ? <Empty className="min-h-80 rounded-none border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-status-error/10 text-status-error"><AlertTriangleIcon /></EmptyMedia><EmptyTitle>Failed to load Departments</EmptyTitle><EmptyDescription>{error ?? "Could not reach the backend."}</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" variant="destructive" onClick={() => void load()}>Retry</Button></EmptyContent></Empty> : null}
      {status === "loaded" && departments.length === 0 ? <Empty className="min-h-80 rounded-none border-0"><EmptyHeader><EmptyMedia variant="icon"><Building2Icon /></EmptyMedia><EmptyTitle>No Departments found</EmptyTitle><EmptyDescription>Create a Department to establish reusable defaults for future Agents.</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" size="sm" onClick={openCreate}><PlusIcon />Create Department</Button></EmptyContent></Empty> : null}
      {status === "loaded" && departments.length > 0 && visibleDepartments.length === 0 ? <Empty className="min-h-64 rounded-none border-0"><EmptyHeader><EmptyTitle>No matching Departments</EmptyTitle><EmptyDescription>No Department matches the current search and status filter.</EmptyDescription></EmptyHeader></Empty> : null}
      {status === "loaded" && visibleDepartments.length > 0 ? <Table className="min-w-[850px]"><TableHeader className="bg-surface-interactive/45"><TableRow className="hover:bg-transparent"><TableHead>Department</TableHead><TableHead>Role</TableHead><TableHead>Runtime defaults</TableHead><TableHead>Agents</TableHead><TableHead>Updated</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{visibleDepartments.map((item) => <TableRow key={item.id} className="h-16 border-divider hover:bg-surface-interactive/45"><TableCell><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-brand-accent"><Building2Icon className="size-4" /></div><div><div className="font-medium text-text-primary">{item.name}</div><div className="font-mono text-[11px] text-text-muted">{item.slug}</div></div></div></TableCell><TableCell className="text-sm text-text-secondary">{item.role}</TableCell><TableCell><div className="text-sm text-text-secondary">{item.harness} · {item.defaultModel}</div><div className="text-xs text-text-muted">{item.defaultReasoning}</div></TableCell><TableCell className="font-mono text-sm text-text-secondary">{item.agentCount}</TableCell><TableCell className="text-xs text-text-muted">{formatUpdatedAt(item.updatedAt)}</TableCell><TableCell><Badge variant={item.enabled ? "success" : "disabled"}>{item.enabled ? "Enabled" : "Disabled"}</Badge></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} />}><MoreHorizontalIcon /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEdit(item.id)}><PencilIcon />Edit Department</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table> : null}
      {status === "loaded" ? <footer className="border-t border-divider bg-surface-interactive/30 px-4 py-2.5 text-xs text-text-muted">Showing {visibleDepartments.length} of {departments.length} {departments.length === 1 ? "Department" : "Departments"}</footer> : null}
    </section>
    <DepartmentConfigDrawer key={`${drawerMode}:${department?.id ?? "new"}`} open={drawerOpen} mode={drawerMode} department={department} onOpenChange={setDrawerOpen} onRefresh={load} />
  </div>;
}
