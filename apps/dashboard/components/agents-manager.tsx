"use client";

import {
  AlertTriangleIcon,
  BotIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  TableIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentMonitoringOverview,
  AgentWithRoutes,
  Team,
} from "@orc/shared";

import { AgentConfigDrawer } from "@/components/agent-config-drawer";
import { AgentWorkflowView } from "@/components/agent-workflow-view";
import { MetricCard } from "@/components/metric-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAgentMonitoringOverview } from "@/lib/agents";
import {
  formatIdentifier,
  scopeAgentsToTeam,
  type AgentStatusFilter,
} from "@/lib/agent-presentation";
import { getAgentInitials, getAgentToneIndex } from "@/lib/team-presentation";
import {
  countConfiguredLayers,
  getAgentCapabilityLabels,
  getTeamRouteRows,
  getVisibleTeamAgents,
  getWorkflowOrderedAgents,
  type TeamAgentSortKey,
  type TeamAgentViewMode,
} from "@/lib/team-workspace-presentation";
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
 * Converts unknown request failures into concise operator-facing text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to load Team Agent configuration";
}

/**
 * Determines whether a request failure was caused by intentional browser cancellation.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Formats one Agent update timestamp without inventing runtime activity.
 */
function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

/**
 * Renders one deterministic Agent initials avatar using existing semantic color tokens.
 */
function AgentAvatar({ agent }: { agent: AgentWithRoutes }) {
  const toneClass =
    agentToneClasses[getAgentToneIndex(agent.id, agentToneClasses.length)];

  return (
    <Avatar
      size="sm"
      title={`${agent.name}, ${agent.role}`}
      aria-label={`${agent.name}, ${agent.role}`}
      className={cn(!agent.enabled && "opacity-55 grayscale")}
    >
      <AvatarFallback className={cn("text-[10px] font-semibold", toneClass)}>
        {getAgentInitials(agent.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Renders Agent identity with the concise role, layer, and model secondary line from the redesign.
 */
function AgentIdentity({
  agent,
  onEdit,
}: {
  agent: AgentWithRoutes;
  onEdit: (agentId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onEdit(agent.id)}
      className="group flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      aria-label={`Edit ${agent.name}`}
    >
      <AgentAvatar agent={agent} />

      <span className="min-w-0">
        <span className="block truncate font-medium text-text-primary group-hover:text-link">
          {agent.name}
        </span>

        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {agent.role} · L{agent.layer} · {agent.model}
        </span>
      </span>
    </button>
  );
}

/**
 * Renders only persisted Agent capability flags as compact badges.
 */
function AgentCapabilities({ agent }: { agent: AgentWithRoutes }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {getAgentCapabilityLabels(agent).map((capability) => (
        <Badge key={capability} variant="outline" className="font-normal">
          {capability}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Renders persisted Agent enabled state through the shared semantic badge system.
 */
function AgentStatus({ agent }: { agent: AgentWithRoutes }) {
  return (
    <Badge variant={agent.enabled ? "success" : "disabled"}>
      {agent.enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}

type AgentCollectionViewProps = {
  agents: AgentWithRoutes[];
  onEdit: (agentId: string) => void;
};

/**
 * Renders the default high-signal Team Agent table.
 */
function AgentTableView({ agents, onEdit }: AgentCollectionViewProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader className="bg-surface-interactive/45">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Agent
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Execution Order
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Capabilities
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Status
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Last Updated
            </TableHead>
            <TableHead className="h-9 w-14 px-3 text-right text-xs text-text-secondary">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {agents.map((agent) => (
            <TableRow
              key={agent.id}
              className="h-16 border-divider hover:bg-surface-interactive/45"
            >
              <TableCell className="px-4 py-2.5">
                <AgentIdentity agent={agent} onEdit={onEdit} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <div className="text-sm text-text-secondary">
                  {agent.executionOrder}
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  Layer {agent.layer}
                </div>
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentCapabilities agent={agent} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentStatus agent={agent} />
              </TableCell>

              <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs text-text-secondary">
                {formatUpdatedAt(agent.updatedAt)}
              </TableCell>

              <TableCell className="px-3 py-2.5 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(agent.id)}
                  aria-label={`Edit ${agent.name}`}
                >
                  <PencilIcon />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Renders a relaxed horizontal Agent list using the same filtered and sorted collection.
 */
function AgentListView({ agents, onEdit }: AgentCollectionViewProps) {
  return (
    <div className="divide-y divide-divider">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-surface-interactive/35 lg:flex-row lg:items-center"
        >
          <div className="min-w-0 flex-1">
            <AgentIdentity agent={agent} onEdit={onEdit} />
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <AgentCapabilities agent={agent} />

            <span className="whitespace-nowrap text-xs text-text-muted">
              Order {agent.executionOrder}
            </span>

            <AgentStatus agent={agent} />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEdit(agent.id)}
            >
              <PencilIcon />
              Edit
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the persisted technical configuration fields required for a denser Agent comparison.
 */
function AgentDetailedView({ agents, onEdit }: AgentCollectionViewProps) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1180px]">
        <TableHeader className="bg-surface-interactive/45">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Agent
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Layer / Order
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Harness / Model
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Reasoning
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Capabilities
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Status
            </TableHead>
            <TableHead className="h-9 px-4 text-xs text-text-secondary">
              Updated
            </TableHead>
            <TableHead className="h-9 w-14 px-3 text-right text-xs text-text-secondary">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {agents.map((agent) => (
            <TableRow
              key={agent.id}
              className="h-16 border-divider hover:bg-surface-interactive/45"
            >
              <TableCell className="px-4 py-2.5">
                <AgentIdentity agent={agent} onEdit={onEdit} />
              </TableCell>

              <TableCell className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                L{agent.layer} · #{agent.executionOrder}
              </TableCell>

              <TableCell className="px-4 py-2.5 text-xs">
                <div className="font-mono text-text-secondary">
                  {agent.harness}
                </div>
                <div className="mt-0.5 font-mono text-text-muted">
                  {agent.model}
                </div>
              </TableCell>

              <TableCell className="px-4 py-2.5 text-xs text-text-secondary">
                {agent.reasoning}
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentCapabilities agent={agent} />
              </TableCell>

              <TableCell className="px-4 py-2.5">
                <AgentStatus agent={agent} />
              </TableCell>

              <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs text-text-secondary">
                {formatUpdatedAt(agent.updatedAt)}
              </TableCell>

              <TableCell className="px-3 py-2.5 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(agent.id)}
                  aria-label={`Edit ${agent.name}`}
                >
                  <PencilIcon />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Renders responsive Agent cards without changing collection semantics.
 */
function AgentGridView({ agents, onEdit }: AgentCollectionViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {agents.map((agent) => (
        <Card
          key={agent.id}
          size="sm"
          className="gap-3 rounded-lg bg-surface-card shadow-none ring-1 ring-border-default transition-colors hover:bg-surface-interactive/35"
        >
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <AgentIdentity agent={agent} onEdit={onEdit} />

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(agent.id)}
                aria-label={`Edit ${agent.name}`}
              >
                <PencilIcon />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AgentStatus agent={agent} />
              <Badge variant="outline">Order {agent.executionOrder}</Badge>
            </div>
          </CardHeader>

          <CardContent className="grid gap-3 text-xs">
            <AgentCapabilities agent={agent} />

            <div className="grid grid-cols-[88px_1fr] gap-2 border-t border-divider pt-3">
              <span className="text-text-muted">Harness</span>
              <span className="font-mono text-text-secondary">
                {agent.harness}
              </span>

              <span className="text-text-muted">Reasoning</span>
              <span className="text-text-secondary">{agent.reasoning}</span>

              <span className="text-text-muted">Updated</span>
              <span className="text-text-secondary">
                {formatUpdatedAt(agent.updatedAt)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Renders the generic workflow execution order from current persisted Agent configuration.
 */
function ExecutionOrderCard({ agents }: { agents: AgentWithRoutes[] }) {
  const orderedAgents = getWorkflowOrderedAgents(agents);

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="border-b border-divider">
        <div>
          <CardTitle>Execution Order</CardTitle>
          <p className="mt-1 text-xs text-text-muted">
            Layer first, then configured same-layer order.
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {orderedAgents.length === 0 ? (
          <p className="p-5 text-xs text-text-muted">
            No Agents are configured for this Team.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader className="bg-surface-interactive/35">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-12 px-3 text-xs text-text-secondary">
                    #
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Agent
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Layer
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Order
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {orderedAgents.map((agent, index) => (
                  <TableRow key={agent.id} className="border-divider">
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-text-muted">
                      {index + 1}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-medium text-text-primary">
                      {agent.name}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-text-secondary">
                      {agent.layer}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-text-secondary">
                      {agent.executionOrder}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <AgentStatus agent={agent} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders persisted explicit routing records without inferring role-specific behavior.
 */
function RoutingRulesCard({ agents }: { agents: AgentWithRoutes[] }) {
  const routeRows = getTeamRouteRows(agents);

  return (
    <Card size="sm" className="min-w-0">
      <CardHeader className="border-b border-divider">
        <div>
          <CardTitle>Routing Rules</CardTitle>
          <p className="mt-1 text-xs text-text-muted">
            Explicit persisted outcome routes for this Team.
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {routeRows.length === 0 ? (
          <p className="p-5 text-xs text-text-muted">
            No explicit routing rules are configured. Normal enabled-Agent
            progression follows layer and execution order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[680px]">
              <TableHeader className="bg-surface-interactive/35">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    From
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Outcome
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    To
                  </TableHead>
                  <TableHead className="h-9 px-3 text-xs text-text-secondary">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {routeRows.map((route) => (
                  <TableRow key={route.id} className="border-divider">
                    <TableCell className="px-3 py-2.5 text-xs font-medium text-text-primary">
                      {route.sourceName}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-text-secondary">
                      {formatIdentifier(route.outcome)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-text-secondary">
                      {route.terminal
                        ? formatIdentifier(route.destination)
                        : route.destination}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge variant={route.enabled ? "success" : "disabled"}>
                        {route.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type AgentsManagerProps = {
  team: Team;
};

/**
 * Renders the dedicated Team workspace with focused Agents and Workflow tabs.
 */
export function AgentsManager({ team }: AgentsManagerProps) {
  const [overview, setOverview] = useState<AgentMonitoringOverview | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [sortKey, setSortKey] = useState<TeamAgentSortKey>("name");
  const [viewMode, setViewMode] = useState<TeamAgentViewMode>("table");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [drawerSession, setDrawerSession] = useState(0);
  const overviewAbort = useRef<AbortController | null>(null);

  /**
   * Loads the Team-scoped Agent and route read model while preserving prior data on explicit refresh failures.
   */
  const loadOverview = useCallback(
    async (preferredAgentId?: string, preserveOnError = false) => {
      overviewAbort.current?.abort();

      const controller = new AbortController();

      overviewAbort.current = controller;

      if (!preserveOnError) {
        setStatus("loading");
        setError(null);
      }

      setRefreshError(null);

      try {
        const next = await getAgentMonitoringOverview(
          "7d",
          team.id,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        const scopedAgents = scopeAgentsToTeam(next.agents, team.id);
        const scopedOverview = {
          ...next,
          agents: scopedAgents,
        };

        setOverview(scopedOverview);
        setStatus("loaded");
        setError(null);
        setSelectedAgentId((current) => {
          if (
            preferredAgentId &&
            scopedAgents.some((agent) => agent.id === preferredAgentId)
          ) {
            return preferredAgentId;
          }

          if (current && scopedAgents.some((agent) => agent.id === current)) {
            return current;
          }

          return scopedAgents[0]?.id ?? null;
        });
      } catch (caught) {
        if (isAbortError(caught)) {
          return;
        }

        const message = errorMessage(caught);

        if (preserveOnError) {
          setRefreshError(message);
        } else {
          setError(message);
          setStatus("error");
        }
      } finally {
        if (!controller.signal.aborted) {
          setRefreshing(false);
        }
      }
    },
    [team.id],
  );

  useEffect(() => {
    let disposed = false;

    queueMicrotask(() => {
      if (!disposed) {
        void loadOverview();
      }
    });

    return () => {
      disposed = true;
      overviewAbort.current?.abort();
    };
  }, [loadOverview]);

  const agents = useMemo(
    () => scopeAgentsToTeam(overview?.agents ?? [], team.id),
    [overview?.agents, team.id],
  );

  const availableLayers = useMemo(
    () =>
      [...new Set(agents.map((agent) => agent.layer))].sort(
        (left, right) => left - right,
      ),
    [agents],
  );

  const visibleAgents = useMemo(
    () =>
      getVisibleTeamAgents(
        agents,
        search,
        layerFilter === "all" ? null : Number(layerFilter),
        statusFilter,
        sortKey,
      ),
    [agents, search, layerFilter, statusFilter, sortKey],
  );

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const routeRows = useMemo(() => getTeamRouteRows(agents), [agents]);

  const enabledRouteCount = routeRows.filter((route) => route.enabled).length;

  /**
   * Opens a fresh Team-scoped create-Agent drawer session.
   */
  function openCreateDrawer() {
    setDrawerMode("create");
    setDrawerSession((current) => current + 1);
    setDrawerOpen(true);
  }

  /**
   * Selects one persisted Agent and opens the existing configuration drawer for editing.
   */
  function openEditDrawer(agentId: string) {
    setSelectedAgentId(agentId);
    setDrawerMode("edit");
    setDrawerSession((current) => current + 1);
    setDrawerOpen(true);
  }

  /**
   * Refreshes Team Agent configuration while keeping the current successful snapshot visible on failure.
   */
  async function refresh() {
    setRefreshing(true);

    await loadOverview(selectedAgentId ?? undefined, status === "loaded");
  }

  /**
   * Reloads the Team Agent collection after the existing drawer persists an Agent or route mutation.
   */
  async function refreshAfterMutation(preferredAgentId: string | null) {
    setRefreshing(true);

    await loadOverview(preferredAgentId ?? undefined, true);
  }

  if (status === "loading" && !overview) {
    return (
      <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
        <Spinner className="size-6" />
        <EmptyTitle>Loading Team Agents...</EmptyTitle>
      </Empty>
    );
  }

  if (status === "error" && !overview) {
    return (
      <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia
            variant="icon"
            className="bg-status-error/10 text-status-error"
          >
            <AlertTriangleIcon />
          </EmptyMedia>

          <EmptyTitle>Failed to load Team Agents</EmptyTitle>

          <EmptyDescription>
            {error ?? "Could not load the Team Agent configuration."}
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadOverview()}
          >
            <RefreshCwIcon />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!overview) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {refreshError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-error/30 bg-status-error/5 px-3 py-2 text-xs text-status-error"
        >
          <span>Failed to refresh Team Agents. {refreshError}</span>

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

      <Tabs defaultValue="agents" className="min-w-0 gap-4">
        <TabsList
          variant="line"
          className="w-full justify-start border-b border-divider pb-0"
        >
          <TabsTrigger value="agents" className="flex-none px-3 py-2.5">
            Agents
          </TabsTrigger>

          <TabsTrigger value="workflow" className="flex-none px-3 py-2.5">
            Workflow
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="min-w-0">
          <section
            className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
            aria-label={`${team.name} Agents browser`}
          >
            <div className="grid gap-3 border-b border-divider p-3 2xl:grid-cols-[minmax(18rem,1fr)_auto] 2xl:items-center">
              <InputGroup className="w-full min-w-0 2xl:max-w-xl">
                <InputGroupAddon>
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>

                <InputGroupInput
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search Agents..."
                  aria-label="Search Agents"
                />
              </InputGroup>

              <div className="flex min-w-0 flex-wrap items-center gap-2 2xl:justify-end">
                <NativeSelect
                  size="default"
                  className="w-full sm:w-44"
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.target.value as TeamAgentSortKey)
                  }
                  aria-label="Sort Agents"
                >
                  <NativeSelectOption value="name">
                    Sorted by Name
                  </NativeSelectOption>
                  <NativeSelectOption value="workflow">
                    Workflow Order
                  </NativeSelectOption>
                  <NativeSelectOption value="updatedAt">
                    Recently Updated
                  </NativeSelectOption>
                </NativeSelect>

                <NativeSelect
                  size="default"
                  className="w-full sm:w-36"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as AgentStatusFilter)
                  }
                  aria-label="Filter Agents by status"
                >
                  <NativeSelectOption value="all">
                    All Status
                  </NativeSelectOption>
                  <NativeSelectOption value="enabled">
                    Enabled
                  </NativeSelectOption>
                  <NativeSelectOption value="disabled">
                    Disabled
                  </NativeSelectOption>
                </NativeSelect>

                <NativeSelect
                  size="default"
                  className="w-full sm:w-36"
                  value={layerFilter}
                  onChange={(event) => setLayerFilter(event.target.value)}
                  aria-label="Filter Agents by layer"
                >
                  <NativeSelectOption value="all">
                    All Layers
                  </NativeSelectOption>
                  {availableLayers.map((layer) => (
                    <NativeSelectOption key={layer} value={String(layer)}>
                      Layer {layer}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                >
                  <RefreshCwIcon
                    className={cn(
                      refreshing && "animate-spin motion-reduce:animate-none",
                    )}
                  />
                  Refresh
                </Button>

                <Button type="button" onClick={openCreateDrawer}>
                  <PlusIcon />
                  Create Agent
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-b border-divider bg-surface-interactive/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-text-muted">
                {visibleAgents.length} of {agents.length}{" "}
                {agents.length === 1 ? "Agent" : "Agents"}
              </span>

              <ButtonGroup
                className="w-full sm:w-auto"
                aria-label="Agent view mode"
              >
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "flex-1 sm:flex-none",
                    viewMode === "table" &&
                      "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
                  )}
                  aria-pressed={viewMode === "table"}
                  onClick={() => setViewMode("table")}
                >
                  <TableIcon />
                  Table
                </Button>

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
                >
                  <ListIcon />
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
                >
                  <TableIcon />
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
                >
                  <LayoutGridIcon />
                  Grid
                </Button>
              </ButtonGroup>
            </div>

            {agents.length === 0 ? (
              <Empty className="min-h-72 rounded-none border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BotIcon />
                  </EmptyMedia>

                  <EmptyTitle>No Agents configured</EmptyTitle>

                  <EmptyDescription>
                    Create the first Agent for this Team.
                  </EmptyDescription>
                </EmptyHeader>

                <EmptyContent>
                  <Button type="button" size="sm" onClick={openCreateDrawer}>
                    <PlusIcon />
                    Create Agent
                  </Button>
                </EmptyContent>
              </Empty>
            ) : visibleAgents.length === 0 ? (
              <Empty className="min-h-64 rounded-none border-0">
                <EmptyHeader>
                  <EmptyTitle>No matching Agents</EmptyTitle>

                  <EmptyDescription>
                    No Agent matches the current search, layer, and status
                    filters.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                {viewMode === "table" ? (
                  <AgentTableView
                    agents={visibleAgents}
                    onEdit={openEditDrawer}
                  />
                ) : null}

                {viewMode === "list" ? (
                  <AgentListView
                    agents={visibleAgents}
                    onEdit={openEditDrawer}
                  />
                ) : null}

                {viewMode === "details" ? (
                  <AgentDetailedView
                    agents={visibleAgents}
                    onEdit={openEditDrawer}
                  />
                ) : null}

                {viewMode === "grid" ? (
                  <AgentGridView
                    agents={visibleAgents}
                    onEdit={openEditDrawer}
                  />
                ) : null}
              </>
            )}
          </section>
        </TabsContent>

        <TabsContent value="workflow" className="min-w-0">
          <div className="grid min-w-0 gap-3">
            <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Total Agents"
                value={String(agents.length)}
                description="Configured for this Team"
                icon={<BotIcon className="size-4 text-brand-accent" />}
              />

              <MetricCard
                label="Enabled Agents"
                value={String(agents.filter((agent) => agent.enabled).length)}
                description="Eligible for future run snapshots"
                icon={<BotIcon className="size-4 text-status-success" />}
              />

              <MetricCard
                label="Enabled Routes"
                value={String(enabledRouteCount)}
                description={`${routeRows.length} explicit route${routeRows.length === 1 ? "" : "s"} configured`}
                icon={<RouteIcon className="size-4 text-status-running" />}
              />

              <MetricCard
                label="Layers"
                value={String(countConfiguredLayers(agents))}
                description="Configured workflow layers"
                icon={<TableIcon className="size-4 text-text-secondary" />}
              />
            </section>

            {overview.validationIssues.length > 0 ? (
              <div
                role="alert"
                className="flex gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {overview.validationIssues.length} workflow configuration
                  issue
                  {overview.validationIssues.length === 1 ? "" : "s"} detected.
                  Review affected Agent routes before the next run.
                </span>
              </div>
            ) : null}

            <AgentWorkflowView
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />

            <section className="grid min-w-0 items-start gap-3 xl:grid-cols-2">
              <ExecutionOrderCard agents={agents} />

              <RoutingRulesCard agents={agents} />
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <AgentConfigDrawer
        key={`${team.id}:${drawerSession}:${drawerMode}:${
          drawerMode === "edit" ? (selectedAgent?.id ?? "none") : "create"
        }`}
        open={drawerOpen}
        mode={drawerMode}
        createTeamId={team.id}
        agent={drawerMode === "edit" ? selectedAgent : null}
        agents={agents}
        onOpenChange={setDrawerOpen}
        onRefresh={refreshAfterMutation}
      />
    </div>
  );
}
