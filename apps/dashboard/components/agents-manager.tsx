"use client";

import Link from "next/link";
import { PlusIcon, RefreshCwIcon, PencilIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Department, Skill, Team } from "@orc/shared";
import { AgentConfigDrawer } from "@/components/agent-config-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAgents } from "@/lib/agents";
import { getDepartments } from "@/lib/departments";
import { getTeams } from "@/lib/teams";
import { getSkills } from "@/lib/skills";
import { AGENT_VIEW_MODES, getVisibleAgents, type AgentViewMode, type AgentStatusFilter } from "@/lib/agent-collection";

/** Browses independent Agents using persisted Department and Team relationships. */
export function AgentsManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [view, setView] = useState<AgentViewMode>("table");
  const [editor, setEditor] = useState<{ agent: Agent | null } | null>(null);
  const load = useCallback(async () => {
    try {
      const [nextAgents, nextDepartments, nextTeams, nextSkills] = await Promise.all([getAgents(), getDepartments(), getTeams(), getSkills()]);
      setAgents(nextAgents); setDepartments(nextDepartments); setTeams(nextTeams); setSkills(nextSkills); setStatus("loaded"); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Agents"); setStatus("error"); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { let disposed = false; queueMicrotask(() => { if (!disposed) void load(); }); return () => { disposed = true; }; }, [load]);
  const visible = useMemo(() => getVisibleAgents(agents, query, departmentFilter, teamFilter, statusFilter), [agents, query, departmentFilter, teamFilter, statusFilter]);
  const teamName = (agent: Agent) => teams.find((team) => team.id === agent.currentTeamId)?.name ?? (agent.currentTeamId ? "Assigned Team" : "Unassigned");
  const edit = (agent: Agent) => <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${agent.name}`} onClick={() => setEditor({ agent })}><PencilIcon /></Button>;
  const badge = (agent: Agent) => <span className="grid gap-1"><Badge variant={agent.enabled ? "success" : "disabled"}>{agent.enabled ? "Enabled" : "Disabled"}</Badge>{agent.enabled && !agent.effective.enabled ? <span className="text-xs text-text-muted">Department disabled</span> : null}</span>;
  return <div className="flex min-w-0 flex-1 flex-col gap-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-heading text-2xl font-semibold">Agents</h1><p className="mt-1 text-sm text-text-muted">Manage reusable Agents, Department inheritance, and runtime configuration.</p></div><Button onClick={() => setEditor({ agent: null })} disabled={status !== "loaded" || departments.length === 0}><PlusIcon />Create Agent</Button></header>
    {status === "loaded" && departments.length === 0 ? <p className="rounded-md border border-border-default p-4 text-sm">An Agent requires a Department. <Link href="/departments" className="underline">Create a Department</Link> to get started.</p> : null}
    <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated" aria-label="Agents browser">
      <div className="flex flex-wrap gap-3 border-b border-divider p-3">
        <Input className="min-w-48 flex-1" type="search" aria-label="Search Agents" placeholder="Search Agents..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <NativeSelect value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} aria-label="Filter by Department"><NativeSelectOption value="all">All Departments</NativeSelectOption>{departments.map((department) => <NativeSelectOption key={department.id} value={department.id}>{department.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Filter by Team"><NativeSelectOption value="all">All Teams</NativeSelectOption><NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>{teams.map((team) => <NativeSelectOption key={team.id} value={team.id}>{team.name}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AgentStatusFilter)} aria-label="Filter by status"><NativeSelectOption value="all">All statuses</NativeSelectOption><NativeSelectOption value="enabled">Enabled</NativeSelectOption><NativeSelectOption value="disabled">Disabled</NativeSelectOption></NativeSelect>
        <Button variant="outline" onClick={() => { setRefreshing(true); void load(); }} disabled={refreshing}><RefreshCwIcon className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />Refresh</Button>
        <div role="group" aria-label="Agent view" className="flex flex-wrap gap-1">{AGENT_VIEW_MODES.map((mode) => <Button key={mode} size="sm" variant={view === mode ? "secondary" : "ghost"} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === "details" ? "Detailed" : mode[0].toUpperCase() + mode.slice(1)}</Button>)}</div>
      </div>
      {status === "loading" ? <Empty className="min-h-64"><Spinner /><EmptyTitle>Loading Agents...</EmptyTitle></Empty> : status === "error" ? <Empty className="min-h-64"><EmptyTitle>Failed to load Agents</EmptyTitle><EmptyDescription>{error}</EmptyDescription><Button onClick={() => void load()}>Retry</Button></Empty> : visible.length === 0 ? <Empty className="min-h-64"><EmptyTitle>{agents.length ? "No matching Agents" : "No Agents yet"}</EmptyTitle><EmptyDescription>{agents.length ? "Try another search or filter." : "Create an Agent with Department defaults. Add it to a Team when ready."}</EmptyDescription></Empty> : view === "table" ?
        <Table className="min-w-[850px]"><TableHeader><TableRow>{["Agent", "Department", "Runtime", "Team", "Status", "Updated", "Actions"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{visible.map((agent) => <TableRow key={agent.id}><TableCell><div className="font-medium">{agent.name}</div><div className="font-mono text-xs text-text-muted">{agent.slug}</div></TableCell><TableCell>{agent.department.name}<div className="text-xs text-text-muted">{agent.effective.role}</div></TableCell><TableCell>{agent.effective.harness} · {agent.effective.model}<div className="text-xs text-text-muted">{agent.effective.reasoning}</div></TableCell><TableCell>{teamName(agent)}</TableCell><TableCell>{badge(agent)}</TableCell><TableCell className="text-xs text-text-muted">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(agent.updatedAt))}</TableCell><TableCell>{edit(agent)}</TableCell></TableRow>)}</TableBody></Table> :
        <div className={view === "grid" ? "grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y divide-divider"}>{visible.map((agent) => <article key={agent.id} className={view === "grid" ? "min-w-0 rounded-md border border-border-default p-4" : "p-3"}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-medium">{agent.name}</h2><p className="truncate text-xs text-text-muted">{agent.slug} · {agent.department.name}</p></div><div className="flex shrink-0 items-center gap-2">{badge(agent)}{edit(agent)}</div></div><p className="mt-2 break-words text-sm text-text-secondary">{agent.effective.harness} · {agent.effective.model} · {agent.effective.reasoning} · {teamName(agent)}</p>{view !== "list" ? <p className="mt-2 text-xs text-text-muted">Role: {agent.effective.role} · Updated {new Date(agent.updatedAt).toLocaleDateString("en")}</p> : null}{view === "details" ? <p className="mt-2 text-sm text-text-muted">Write: {String(agent.effective.canWrite)} · Commands: {String(agent.effective.canRunCommands)} · Commit: {String(agent.effective.canCommit)} · Sandbox: {agent.effective.sandboxMode ?? "Unavailable"}</p> : null}</article>)}</div>}
      {status === "loaded" ? <footer className="border-t border-divider px-4 py-3 text-xs text-text-muted">Showing {visible.length} of {agents.length} Agents</footer> : null}
    </section>
    {editor ? <AgentConfigDrawer agent={editor.agent} departments={departments} teams={teams} skills={skills} onOpenChange={(open) => { if (!open) setEditor(null); }} onRefresh={load} /> : null}
  </div>;
}
