"use client";

import {
  AlertTriangleIcon,
  LayoutGridIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Agent, Team } from "@orc/shared";

import { TeamConfigDrawer } from "@/components/team-config-drawer";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAgents } from "@/lib/agents";
import {
  AGENT_AVATAR_LIMIT,
  getAgentAvatarSummary,
  getAgentInitials,
  getAgentToneIndex,
  getVisibleTeams,
  groupAgentsByTeam,
  type TeamSortKey,
  type TeamStatusFilter,
  type TeamViewMode,
} from "@/lib/team-presentation";
import { getTeams } from "@/lib/teams";
import { cn } from "@/lib/utils";

const agentToneClasses = [
  "bg-brand-accent/15 text-brand-accent",
  "bg-status-running/15 text-status-running",
  "bg-status-success/15 text-status-success",
  "bg-status-warning/15 text-status-warning",
  "bg-neon-cyan/15 text-neon-cyan",
  "bg-neon-violet/15 text-neon-violet",
] as const;

/**
 * Converts an unknown Teams workspace failure into concise operator-facing text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Teams";
}

/**
 * Formats one Team timestamp for the secondary date line.
 */
function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

/**
 * Formats a persisted Team timestamp into a compact relative label without changing source data.
 */
function formatRelativeUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  const elapsed = Date.now() - timestamp;

  if (elapsed <= 0) {
    return "Just now";
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) {
    return "Just now";
  }

  if (elapsed < hour) {
    return `${Math.floor(elapsed / minute)}m ago`;
  }

  if (elapsed < day) {
    return `${Math.floor(elapsed / hour)}h ago`;
  }

  return `${Math.floor(elapsed / day)}d ago`;
}

type AgentAvatarStackProps = {
  agents: Agent[];
  showCount?: boolean;
};

/**
 * Renders at most five deterministic Agent initials avatars plus an accessible overflow count.
 */
function AgentAvatarStack({
  agents,
  showCount = false,
}: AgentAvatarStackProps) {
  if (agents.length === 0) {
    return <span className="text-xs text-text-muted">No Agents</span>;
  }

  const { visibleAgents, overflowCount } = getAgentAvatarSummary(
    agents,
    AGENT_AVATAR_LIMIT,
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <AvatarGroup>
        {visibleAgents.map((agent) => {
          const toneClass =
            agentToneClasses[
              getAgentToneIndex(agent.id, agentToneClasses.length)
            ];
          const accessibleLabel = `${agent.name}, ${agent.effective.role}${
            agent.enabled ? "" : ", disabled"
          }`;

          return (
            <Avatar
              key={agent.id}
              size="sm"
              title={accessibleLabel}
              aria-label={accessibleLabel}
              className={cn(!agent.enabled && "opacity-50 grayscale")}
            >
              <AvatarFallback
                className={cn("text-[10px] font-semibold", toneClass)}
              >
                {getAgentInitials(agent.name)}
              </AvatarFallback>
            </Avatar>
          );
        })}

        {overflowCount > 0 ? (
          <AvatarGroupCount
            title={`${overflowCount} more Agents`}
            aria-label={`${overflowCount} more Agents`}
            className="size-6 text-[10px] font-semibold text-text-secondary"
          >
            +{overflowCount}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>

      {showCount ? (
        <span className="whitespace-nowrap text-xs text-text-muted">
          {agents.length} {agents.length === 1 ? "Agent" : "Agents"}
        </span>
      ) : null}
    </div>
  );
}

type TeamIdentityProps = {
  team: Team;
  compact?: boolean;
};

/**
 * Renders the Team name as primary content with its persisted slug and description beneath it.
 */
function TeamIdentity({ team, compact = false }: TeamIdentityProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-interactive text-brand-accent">
        <UsersIcon className="size-4" aria-hidden="true" />
      </div>

      <div className="min-w-0">
        <div className="truncate font-medium text-text-primary">
          {team.name}
        </div>

        <div
          className={cn(
            "mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-muted",
            compact ? "max-w-64" : "max-w-xl",
          )}
        >
          <span className="shrink-0 font-mono text-[11px]">{team.slug}</span>

          {team.description ? (
            <>
              <span aria-hidden="true">•</span>

              <span className="truncate" title={team.description}>
                {team.description}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the persisted Team enabled state using the existing semantic status system.
 */
function TeamStatusBadge({ team }: { team: Team }) {
  return (
    <Badge variant={team.enabled ? "success" : "disabled"}>
      {team.enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}

/**
 * Renders a compact relative and absolute update timestamp matching the list hierarchy.
 */
function TeamUpdatedAt({ value }: { value: string }) {
  return (
    <div className="whitespace-nowrap text-xs">
      <div className="text-text-secondary">
        {formatRelativeUpdatedAt(value)}
      </div>

      <div className="mt-0.5 text-text-muted">{formatUpdatedAt(value)}</div>
    </div>
  );
}

type TeamActionsProps = {
  team: Team;
  onManageAgents: (teamId: string) => void;
  onEdit: (teamId: string) => void;
};

/**
 * Keeps Team row actions compact while preserving Agent management and Team editing.
 */
function TeamActions({ team, onManageAgents, onEdit }: TeamActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${team.name}`}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onManageAgents(team.id)}>
          <UsersIcon />
          Manage Agents
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => onEdit(team.id)}>
          <PencilIcon />
          Edit Team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type TeamViewProps = {
  teams: Team[];
  membersByTeam: Map<string, Agent[]>;
  onManageAgents: (teamId: string) => void;
  onEdit: (teamId: string) => void;
};

/**
 * Renders the default concise Teams list using only high-value persisted Team information.
 */
function TeamListView({
  teams,
  membersByTeam,
  onManageAgents,
  onEdit,
}: TeamViewProps) {
  return (
    <Table className="min-w-[900px]">
      <TableHeader className="bg-surface-interactive/45">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Team
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Agents
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Updated
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Status
          </TableHead>

          <TableHead className="h-9 w-14 px-3 text-right text-xs text-text-secondary">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {teams.map((team) => {
          const members = membersByTeam.get(team.id) ?? [];

          return (
            <TableRow
              key={team.id}
              className="h-16 border-divider hover:bg-surface-interactive/45"
            >
              <TableCell className="px-4 py-2.5">
                <TeamIdentity team={team} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentAvatarStack agents={members} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <TeamUpdatedAt value={team.updatedAt} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <TeamStatusBadge team={team} />
              </TableCell>

              <TableCell className="px-3 py-2.5 text-right">
                <TeamActions
                  team={team}
                  onManageAgents={onManageAgents}
                  onEdit={onEdit}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Renders a denser operational view using the additional persisted Team automation fields.
 */
function TeamDetailsView({
  teams,
  membersByTeam,
  onManageAgents,
  onEdit,
}: TeamViewProps) {
  return (
    <Table className="min-w-[1120px]">
      <TableHeader className="bg-surface-interactive/45">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Team
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Agents
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Enabled Agents
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Updated
          </TableHead>

          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Status
          </TableHead>

          <TableHead className="h-9 w-14 px-3 text-right text-xs text-text-secondary">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {teams.map((team) => {
          const members = membersByTeam.get(team.id) ?? [];
          const enabledMembers = members.filter(
            (agent) => agent.enabled,
          ).length;

          return (
            <TableRow
              key={team.id}
              className="h-16 border-divider hover:bg-surface-interactive/45"
            >
              <TableCell className="px-4 py-2.5">
                <TeamIdentity team={team} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentAvatarStack agents={members} showCount />
              </TableCell>

              <TableCell className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                {enabledMembers}/{members.length}
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <TeamUpdatedAt value={team.updatedAt} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <TeamStatusBadge team={team} />
              </TableCell>

              <TableCell className="px-3 py-2.5 text-right">
                <TeamActions
                  team={team}
                  onManageAgents={onManageAgents}
                  onEdit={onEdit}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Renders Teams as responsive cards while preserving the same persisted information hierarchy.
 */
function TeamGridView({
  teams,
  membersByTeam,
  onManageAgents,
  onEdit,
}: TeamViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {teams.map((team) => {
        const members = membersByTeam.get(team.id) ?? [];
        const enabledMembers = members.filter((agent) => agent.enabled).length;

        return (
          <Card
            key={team.id}
            size="sm"
            className="gap-3 rounded-lg bg-surface-card shadow-none ring-1 ring-border-default transition-colors hover:bg-surface-interactive/35"
          >
            <CardHeader className="gap-3">
              <div className="flex items-start justify-between gap-3">
                <TeamIdentity team={team} compact />

                <TeamActions
                  team={team}
                  onManageAgents={onManageAgents}
                  onEdit={onEdit}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TeamStatusBadge team={team} />
              </div>
            </CardHeader>

            <CardContent className="grid gap-3 text-xs">
              <div className="grid gap-1.5">
                <span className="text-text-muted">Agents</span>

                <AgentAvatarStack agents={members} showCount />
              </div>

              <div className="grid grid-cols-[96px_1fr] gap-2 border-t border-divider pt-3">
                <span className="text-text-muted">Enabled</span>

                <span className="font-mono text-text-secondary">
                  {enabledMembers}/{members.length}
                </span>

                <span className="text-text-muted">Updated</span>

                <span className="text-text-secondary">
                  {formatRelativeUpdatedAt(team.updatedAt)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Renders Team CRUD as a focused index and routes Team management to its dedicated workspace.
 */
export function TeamsManager() {
  const router = useRouter();

  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TeamSortKey>("name");
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>("all");
  const [viewMode, setViewMode] = useState<TeamViewMode>("list");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [drawerTeamId, setDrawerTeamId] = useState<string | null>(null);

  /**
   * Reloads persisted Teams and Agent memberships while keeping existing data during explicit refresh failures.
   */
  const loadWorkspace = useCallback(
    async (_preferredTeamId: string | null = null, preserveOnError = false) => {
      void _preferredTeamId;

      if (!preserveOnError) {
        setError(null);
      }

      setRefreshError(null);

      try {
        const [nextTeams, nextAgents] = await Promise.all([
          getTeams(),
          getAgents(),
        ]);

        setTeams(nextTeams);
        setAgents(nextAgents);
        setStatus("loaded");
        setError(null);
      } catch (caught) {
        const message = errorMessage(caught);

        if (preserveOnError) {
          setRefreshError(message);
        } else {
          setError(message);
          setStatus("error");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let disposed = false;

    queueMicrotask(() => {
      if (!disposed) {
        void loadWorkspace();
      }
    });

    return () => {
      disposed = true;
    };
  }, [loadWorkspace]);

  const membersByTeam = useMemo(() => groupAgentsByTeam(agents), [agents]);

  const visibleTeams = useMemo(
    () => getVisibleTeams(teams, membersByTeam, query, statusFilter, sortKey),
    [teams, membersByTeam, query, statusFilter, sortKey],
  );

  const drawerTeam = teams.find((team) => team.id === drawerTeamId) ?? null;

  const drawerMembers = drawerTeam
    ? (membersByTeam.get(drawerTeam.id) ?? [])
    : [];

  /**
   * Opens a fresh Team creation drawer.
   */
  function openCreate() {
    setDrawerTeamId(null);
    setDrawerMode("create");
    setDrawerOpen(true);
  }

  /**
   * Opens one persisted Team in the existing configuration drawer.
   */
  function openEdit(teamId: string) {
    setDrawerTeamId(teamId);
    setDrawerMode("edit");
    setDrawerOpen(true);
  }

  /**
   * Navigates to the dedicated Team Agents and Workflow workspace.
   */
  function openAgentManagement(teamId: string) {
    router.push(`/teams/${teamId}`);
  }

  /**
   * Refreshes the index while preserving successfully loaded data when the refresh request fails.
   */
  async function refresh() {
    setRefreshing(true);

    await loadWorkspace(null, status === "loaded");
  }

  const controlsDisabled = status !== "loaded" || teams.length === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Teams
          </h1>

          <p className="mt-1 text-sm text-text-muted">
            Manage delivery teams, worker Agents, and automation.
          </p>
        </div>

        <Button type="button" onClick={openCreate}>
          <PlusIcon />
          Create Team
        </Button>
      </header>

      <section
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
        aria-label="Teams browser"
      >
        <div className="grid gap-3 border-b border-divider p-3 xl:grid-cols-[minmax(18rem,1fr)_auto] xl:items-center">
          <InputGroup className="w-full min-w-0 xl:max-w-xl">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>

            <InputGroupInput
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search teams or Agents..."
              aria-label="Search Teams"
              disabled={controlsDisabled}
            />
          </InputGroup>

          <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
            <NativeSelect
              size="default"
              className="w-full sm:w-44"
              value={sortKey}
              onChange={(event) =>
                setSortKey(event.target.value as TeamSortKey)
              }
              aria-label="Sort Teams"
              disabled={controlsDisabled}
            >
              <NativeSelectOption value="name">
                Sorted by Name
              </NativeSelectOption>

              <NativeSelectOption value="updatedAt">
                Recently updated
              </NativeSelectOption>
            </NativeSelect>

            <NativeSelect
              size="default"
              className="w-full sm:w-36"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as TeamStatusFilter)
              }
              aria-label="Filter Teams by status"
              disabled={controlsDisabled}
            >
              <NativeSelectOption value="all">All Teams</NativeSelectOption>
              <NativeSelectOption value="enabled">Enabled</NativeSelectOption>
              <NativeSelectOption value="disabled">Disabled</NativeSelectOption>
            </NativeSelect>

            <Button
              type="button"
              variant="outline"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="Refresh Teams"
            >
              <RefreshCwIcon
                className={cn(
                  refreshing && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden="true"
              />
              Refresh
            </Button>

            <ButtonGroup
              className="w-full sm:w-auto"
              aria-label="Team view mode"
            >
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "flex-1 sm:flex-none",
                  viewMode === "list" &&
                    "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
                )}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
                disabled={controlsDisabled}
              >
                <ListIcon aria-hidden="true" />
                List
              </Button>

              <Button
                type="button"
                variant="outline"
                className={cn(
                  "flex-1 sm:flex-none",
                  viewMode === "details" &&
                    "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
                )}
                aria-pressed={viewMode === "details"}
                onClick={() => setViewMode("details")}
                disabled={controlsDisabled}
              >
                <TableIcon aria-hidden="true" />
                Detailed
              </Button>

              <Button
                type="button"
                variant="outline"
                className={cn(
                  "flex-1 sm:flex-none",
                  viewMode === "grid" &&
                    "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
                )}
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
                disabled={controlsDisabled}
              >
                <LayoutGridIcon aria-hidden="true" />
                Grid
              </Button>
            </ButtonGroup>
          </div>
        </div>

        {refreshError && status === "loaded" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-status-error/5 px-4 py-2 text-xs text-status-error"
          >
            <span>Failed to refresh Teams. {refreshError}</span>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              Retry
            </Button>
          </div>
        ) : null}

        <div className="min-w-0">
          {status === "loading" ? (
            <Empty className="min-h-80 rounded-none border-0">
              <Spinner className="size-6" />
              <EmptyTitle>Loading Teams...</EmptyTitle>
            </Empty>
          ) : null}

          {status === "error" ? (
            <Empty className="min-h-80 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia
                  variant="icon"
                  className="bg-status-error/10 text-status-error"
                >
                  <AlertTriangleIcon />
                </EmptyMedia>

                <EmptyTitle>Failed to load Teams</EmptyTitle>

                <EmptyDescription>
                  {error ?? "Could not reach the backend. Please try again."}
                </EmptyDescription>
              </EmptyHeader>

              <EmptyContent>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void loadWorkspace()}
                >
                  Retry
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {status === "loaded" && teams.length === 0 ? (
            <Empty className="min-h-80 rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>

                <EmptyTitle>No Teams found</EmptyTitle>

                <EmptyDescription>
                  Create the first Team to define an Agent ownership boundary.
                </EmptyDescription>
              </EmptyHeader>

              <EmptyContent>
                <Button type="button" size="sm" onClick={openCreate}>
                  <PlusIcon />
                  Create Team
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {status === "loaded" &&
          teams.length > 0 &&
          visibleTeams.length === 0 ? (
            <Empty className="min-h-64 rounded-none border-0">
              <EmptyHeader>
                <EmptyTitle>No matching Teams</EmptyTitle>

                <EmptyDescription>
                  No Team matches the current search and status filter.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {status === "loaded" && visibleTeams.length > 0 ? (
            <>
              {viewMode === "list" ? (
                <TeamListView
                  teams={visibleTeams}
                  membersByTeam={membersByTeam}
                  onManageAgents={openAgentManagement}
                  onEdit={openEdit}
                />
              ) : null}

              {viewMode === "details" ? (
                <TeamDetailsView
                  teams={visibleTeams}
                  membersByTeam={membersByTeam}
                  onManageAgents={openAgentManagement}
                  onEdit={openEdit}
                />
              ) : null}

              {viewMode === "grid" ? (
                <TeamGridView
                  teams={visibleTeams}
                  membersByTeam={membersByTeam}
                  onManageAgents={openAgentManagement}
                  onEdit={openEdit}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {status === "loaded" ? (
          <footer className="flex flex-col gap-1 border-t border-divider bg-surface-interactive/30 px-4 py-2.5 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
            <span aria-live="polite">
              Showing {visibleTeams.length} of {teams.length}{" "}
              {teams.length === 1 ? "Team" : "Teams"}
            </span>

            <span>Agent avatars show up to {AGENT_AVATAR_LIMIT} members.</span>
          </footer>
        ) : null}
      </section>

      <TeamConfigDrawer
        key={`${drawerMode}:${drawerTeam?.id ?? "new"}`}
        open={drawerOpen}
        mode={drawerMode}
        team={drawerTeam}
        memberCount={drawerMembers.length}
        onOpenChange={setDrawerOpen}
        onRefresh={loadWorkspace}
      />
    </div>
  );
}
