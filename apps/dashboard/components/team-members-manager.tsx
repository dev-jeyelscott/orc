"use client";

import Link from "next/link";

import {
  AlertTriangleIcon,
  LayoutGridIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  Rows3Icon,
  SearchIcon,
  TableIcon,
  UserRoundMinusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  Agent,
  Team,
} from "@orc/shared";

import { DataTable, type DataTableColumn } from "@/components/patterns/data-table";
import { StatusBadge } from "@/components/patterns/status-badge";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
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
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  AGENT_VIEW_MODES,
  type AgentViewMode,
} from "@/lib/agent-collection";
import { getAgents } from "@/lib/agents";
import {
  appendTeamMemberAgentIds,
  getMembershipChangeCount,
  getTeamMemberAgentSearchText,
  getTeamMemberCandidateAgents,
  getTeamMemberCandidateAvailability,
  getTeamMemberDepartmentOptions,
  getVisibleTeamMemberAgents,
  removeTeamMemberAgentId,
} from "@/lib/team-member-collection";
import {
  getTeamMembers,
  replaceTeamMembers,
} from "@/lib/team-membership";
import {
  getAgentInitials,
  getAgentToneIndex,
} from "@/lib/team-presentation";
import { cn } from "@/lib/utils";

const agentToneClasses = [
  "bg-brand-accent/15 text-brand-accent",
  "bg-status-running/15 text-status-running",
  "bg-status-success/15 text-status-success",
  "bg-status-warning/15 text-status-warning",
  "bg-neon-cyan/15 text-neon-cyan",
  "bg-neon-violet/15 text-neon-violet",
] as const;

type AgentAvatarProps = {
  agent: Agent;
  size?: "default" | "sm" | "lg";
};

type MemberActionsProps = {
  agent: Agent;
  disabled: boolean;
  onRemove: (agentId: string) => void;
};

type MemberViewProps = {
  agents: Agent[];
  disabled: boolean;
  onRemove: (agentId: string) => void;
};

type TeamMemberPickerProps = {
  team: Team;
  agents: Agent[];
  draftAgents: Agent[];
  disabled: boolean;
  onApply: (agents: Agent[]) => void;
};

/**
 * Converts one unknown Team membership failure into concise operator-facing text.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unable to load Team members";
}

/**
 * Formats one Agent timestamp for the detailed read-only view.
 */
function formatUpdatedAt(
  value: string,
): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

/**
 * Renders one deterministic initials avatar using the existing Team palette.
 */
function AgentAvatar({
  agent,
  size = "default",
}: AgentAvatarProps) {
  const toneClass =
    agentToneClasses[
      getAgentToneIndex(
        agent.id,
        agentToneClasses.length,
      )
    ];

  return (
    <Avatar
      size={size}
      aria-label={`${agent.name}, ${agent.effective.role}`}
    >
      <AvatarFallback
        className={cn(
          "font-semibold",
          toneClass,
        )}
      >
        {getAgentInitials(agent.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Renders the primary Agent identity shared by every collection view.
 */
function AgentIdentity({
  agent,
}: {
  agent: Agent;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AgentAvatar agent={agent} />

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text-primary">
          {agent.name}
        </p>

        <p className="truncate font-mono text-[11px] text-text-muted">
          {agent.slug}
        </p>
      </div>
    </div>
  );
}

/**
 * Renders the effective runtime without exposing Workflow topology.
 */
function AgentRuntime({
  agent,
  compact = false,
}: {
  agent: Agent;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className="truncate text-xs text-text-secondary">
        {agent.effective.harness}
        {" · "}
        {agent.effective.model}
        {" · "}
        {agent.effective.reasoning}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">
        {agent.effective.harness}
      </Badge>

      <Badge variant="outline">
        {agent.effective.model}
      </Badge>

      <Badge variant="outline">
        {agent.effective.reasoning}
      </Badge>
    </div>
  );
}

/**
 * Renders effective Agent availability and explains inherited disablement.
 */
function AgentStatus({
  agent,
}: {
  agent: Agent;
}) {
  const reason =
    agent.effective.enabled
      ? null
      : agent.enabled
        ? "Department disabled"
        : "Agent disabled";

  return (
    <div className="grid gap-1">
      <StatusBadge
        variant={
          agent.effective.enabled
            ? "success"
            : "disabled"
        }
        label={
          agent.effective.enabled
            ? "Enabled"
            : "Disabled"
        }
      />

      {reason ? (
        <span className="text-[11px] text-text-muted">
          {reason}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Stages a deliberate Team-member removal through a compact action menu.
 */
function MemberActions({
  agent,
  disabled,
  onRemove,
}: MemberActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Manage ${agent.name}`}
          />
        }
      >
        Manage
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-52"
      >
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onRemove(agent.id)}
        >
          <UserRoundMinusIcon />
          Remove from Team
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Renders the default high-density Team-member table.
 */
function TeamMemberTable({
  agents,
  disabled,
  onRemove,
}: MemberViewProps) {
  const columns: DataTableColumn<Agent>[] = [
    {
      key: "agent",
      header: "Agent",
      className: "px-4",
      render: (agent) => <AgentIdentity agent={agent} />,
    },
    {
      key: "department",
      header: "Department / Role",
      className: "px-4",
      render: (agent) => (
        <>
          <p className="text-sm text-text-primary">
            {agent.department.name}
          </p>

          <p className="mt-0.5 text-xs text-text-muted">
            {agent.effective.role}
          </p>
        </>
      ),
    },
    {
      key: "runtime",
      header: "Effective runtime",
      className: "px-4",
      render: (agent) => <AgentRuntime agent={agent} />,
    },
    {
      key: "status",
      header: "Status",
      className: "px-4",
      render: (agent) => <AgentStatus agent={agent} />,
    },
    {
      key: "actions",
      header: "Actions",
      className: "w-28 px-4 text-right",
      render: (agent) => (
        <MemberActions
          agent={agent}
          disabled={disabled}
          onRemove={onRemove}
        />
      ),
    },
  ];

  return (
    <div className="overflow-x-auto">
      <DataTable
        className="min-w-[900px]"
        columns={columns}
        rows={agents}
        getRowKey={(agent) => agent.id}
        rowClassName="h-16"
      />
    </div>
  );
}

/**
 * Renders the most compact non-table Team-member collection.
 */
function TeamMemberList({
  agents,
  disabled,
  onRemove,
}: MemberViewProps) {
  return (
    <div className="divide-y divide-divider">
      {agents.map((agent) => (
        <article
          key={agent.id}
          className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <AgentIdentity agent={agent} />

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-11 text-xs text-text-muted">
              <span>{agent.department.name}</span>
              <span aria-hidden="true">•</span>
              <span>{agent.effective.role}</span>
              <span aria-hidden="true">•</span>
              <AgentRuntime
                agent={agent}
                compact
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
            <AgentStatus agent={agent} />

            <MemberActions
              agent={agent}
              disabled={disabled}
              onRemove={onRemove}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Renders additional read-only effective Agent configuration without exposing
 * Workflow layer, order, nodes, or routes.
 */
function TeamMemberDetailed({
  agents,
  disabled,
  onRemove,
}: MemberViewProps) {
  return (
    <div className="divide-y divide-divider">
      {agents.map((agent) => {
        const overrideCount = [
          agent.hasHarnessOverride,
          agent.hasCanWriteOverride,
          agent.hasCanRunCommandsOverride,
          agent.hasSandboxModeOverride,
          agent.hasCanCommitOverride,
          agent.hasModelOverride,
          agent.hasReasoningOverride,
        ].filter(Boolean).length;

        return (
          <article
            key={agent.id}
            className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(220px,1.2fr)_minmax(200px,1fr)_minmax(260px,1.2fr)_auto]"
          >
            <div className="min-w-0">
              <AgentIdentity agent={agent} />

              <p className="mt-2 text-xs text-text-muted">
                Updated {formatUpdatedAt(agent.updatedAt)}
              </p>
            </div>

            <div className="grid content-start gap-1 text-sm">
              <span className="text-xs text-text-muted">
                Department / Role
              </span>

              <span className="text-text-primary">
                {agent.department.name}
              </span>

              <span className="text-xs text-text-secondary">
                {agent.effective.role}
              </span>
            </div>

            <div className="grid gap-3">
              <div>
                <p className="mb-1.5 text-xs text-text-muted">
                  Effective runtime
                </p>

                <AgentRuntime agent={agent} />
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                <span>
                  Write: {agent.effective.canWrite ? "Yes" : "No"}
                </span>

                <span>
                  Commands: {agent.effective.canRunCommands ? "Yes" : "No"}
                </span>

                <span>
                  Commit: {agent.effective.canCommit ? "Yes" : "No"}
                </span>

                <span>
                  Sandbox: {agent.effective.sandboxMode ?? "Unavailable"}
                </span>

                <span>
                  Overrides: {overrideCount}
                </span>
              </div>
            </div>

            <div className="flex items-start justify-between gap-2 xl:justify-end">
              <AgentStatus agent={agent} />

              <MemberActions
                agent={agent}
                disabled={disabled}
                onRemove={onRemove}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * Renders responsive Team-member cards for the Grid presentation.
 */
function TeamMemberGrid({
  agents,
  disabled,
  onRemove,
}: MemberViewProps) {
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <Card
          key={agent.id}
          size="sm"
          className="gap-3 bg-surface-card shadow-none ring-1 ring-border-default"
        >
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <AgentIdentity agent={agent} />

              <MemberActions
                agent={agent}
                disabled={disabled}
                onRemove={onRemove}
              />
            </div>

            <AgentStatus agent={agent} />
          </CardHeader>

          <CardContent className="grid gap-3 text-xs">
            <div>
              <p className="text-text-muted">
                Department / Role
              </p>

              <p className="mt-1 text-sm text-text-primary">
                {agent.department.name}
              </p>

              <p className="mt-0.5 text-text-secondary">
                {agent.effective.role}
              </p>
            </div>

            <div className="border-t border-divider pt-3">
              <p className="mb-1.5 text-text-muted">
                Effective runtime
              </p>

              <AgentRuntime agent={agent} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Renders one icon for each existing Agent collection view mode.
 */
function ViewModeIcon({
  mode,
}: {
  mode: AgentViewMode;
}) {
  if (mode === "table") {
    return <TableIcon aria-hidden="true" />;
  }

  if (mode === "list") {
    return <ListIcon aria-hidden="true" />;
  }

  if (mode === "details") {
    return <Rows3Icon aria-hidden="true" />;
  }

  return <LayoutGridIcon aria-hidden="true" />;
}

/**
 * Formats the existing Agent collection mode into its operator-facing label.
 */
function viewModeLabel(
  mode: AgentViewMode,
): string {
  if (mode === "details") {
    return "Detailed";
  }

  return mode[0].toUpperCase() + mode.slice(1);
}

/**
 * Renders the compact four-mode view switcher shared with Agent registry semantics.
 */
function TeamMemberViewSwitcher({
  view,
  onChange,
}: {
  view: AgentViewMode;
  onChange: (view: AgentViewMode) => void;
}) {
  return (
    <ButtonGroup aria-label="Team member view">
      {AGENT_VIEW_MODES.map((mode) => (
        <Button
          key={mode}
          type="button"
          size="sm"
          variant={
            view === mode
              ? "secondary"
              : "outline"
          }
          aria-pressed={view === mode}
          onClick={() => onChange(mode)}
          title={`${viewModeLabel(mode)} view`}
        >
          <ViewModeIcon mode={mode} />

          <span className="hidden 2xl:inline">
            {viewModeLabel(mode)}
          </span>
        </Button>
      ))}
    </ButtonGroup>
  );
}

/**
 * Renders the searchable multi-select Agent picker while leaving membership
 * persistence to the enclosing draft Save action.
 */
function TeamMemberPicker({
  team,
  agents,
  draftAgents,
  disabled,
  onApply,
}: TeamMemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingAgents, setPendingAgents] = useState<Agent[]>([]);

  const draftAgentIds = useMemo(
    () => draftAgents.map((agent) => agent.id),
    [draftAgents],
  );

  const candidateAgents = useMemo(
    () =>
      getTeamMemberCandidateAgents(
        agents,
        draftAgentIds,
      ),
    [agents, draftAgentIds],
  );

  /**
   * Removes one Agent from the pending picker selection.
   */
  function removePendingAgent(
    agentId: string,
  ) {
    setPendingAgents((current) =>
      current.filter(
        (agent) => agent.id !== agentId,
      ),
    );
  }

  /**
   * Applies the currently valid multi-selection to the parent membership draft.
   */
  function applyPendingAgents() {
    if (pendingAgents.length === 0) {
      return;
    }

    onApply(pendingAgents);
    setPendingAgents([]);
    setOpen(false);
  }

  /**
   * Cancels the picker without changing the Team membership draft.
   */
  function cancelPicker() {
    setPendingAgents([]);
    setOpen(false);
  }

  return (
    <Combobox
      items={candidateAgents}
      multiple
      open={open}
      value={pendingAgents}
      itemToStringLabel={(agent) => agent.name}
      isItemEqualToValue={
        (item, value) =>
          item.id === value.id
      }
      filter={
        (agent, searchQuery) =>
          getTeamMemberAgentSearchText(agent).includes(
            searchQuery.trim().toLowerCase(),
          )
      }
      onValueChange={(nextValue) => {
        setPendingAgents(
          Array.isArray(nextValue)
            ? nextValue
            : [],
        );
      }}
      onOpenChange={(nextOpen, eventDetails) => {
        if (
          !nextOpen &&
          eventDetails.reason === "item-press"
        ) {
          eventDetails.cancel();
          return;
        }

        setOpen(nextOpen);

        if (!nextOpen) {
          setPendingAgents([]);
        }
      }}
      onInputValueChange={(
        _value,
        eventDetails,
      ) => {
        if (eventDetails.reason === "item-press") {
          eventDetails.cancel();
        }
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            type="button"
            disabled={
              disabled ||
              candidateAgents.length === 0
            }
          />
        }
      >
        <PlusIcon />
        Add Agents
      </ComboboxTrigger>

      <ComboboxContent
        align="end"
        sideOffset={8}
        className="w-[min(34rem,calc(100vw-2rem))] p-0"
      >
        <div className="border-b border-divider p-3">
          <p className="mb-2 text-sm font-medium text-text-primary">
            Add Agents to {team.name}
          </p>

          <ComboboxValue>
            {() => (
              <ComboboxChips
                className="min-h-10 w-full"
                aria-label={
                  pendingAgents.length > 0
                    ? "Selected Agents"
                    : undefined
                }
              >
                {pendingAgents.map((agent) => (
                  <ComboboxChip
                    key={agent.id}
                    showRemove={false}
                    aria-label={agent.name}
                    aria-description="Use the remove button to remove this Agent from the pending selection."
                  >
                    {agent.name}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${agent.name} from selection`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removePendingAgent(agent.id);
                      }}
                    >
                      <XIcon />
                    </Button>
                  </ComboboxChip>
                ))}

                <ComboboxChipsInput
                  placeholder="Search Agents..."
                  aria-label="Search available Agents"
                  aria-description={
                    pendingAgents.length > 0
                      ? `${pendingAgents.length} selected.`
                      : undefined
                  }
                />
              </ComboboxChips>
            )}
          </ComboboxValue>
        </div>

        <ComboboxList className="max-h-80 p-1">
          <ComboboxEmpty className="py-6">
            No matching Agents.
          </ComboboxEmpty>

          {candidateAgents.map((agent) => {
            const otherPendingAgents =
              pendingAgents.filter(
                (pendingAgent) =>
                  pendingAgent.id !== agent.id,
              );

            const availability =
              getTeamMemberCandidateAvailability(
                agent,
                team.id,
                draftAgents,
                otherPendingAgents,
              );

            return (
              <ComboboxItem
                key={agent.id}
                value={agent}
                disabled={availability.disabled}
                title={
                  availability.reason ??
                  undefined
                }
                className="min-h-12 items-start py-2.5 pe-10"
              >
                <AgentAvatar
                  agent={agent}
                  size="sm"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text-primary">
                    {agent.name}
                  </p>

                  <p className="truncate text-xs text-text-muted">
                    {agent.department.name}
                    {" · "}
                    {agent.effective.role}
                  </p>
                </div>

                <div className="ml-auto max-w-40 text-right text-[11px] text-text-muted">
                  {availability.reason ??
                    (!agent.effective.enabled
                      ? "Currently disabled"
                      : null)}
                </div>
              </ComboboxItem>
            );
          })}
        </ComboboxList>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider p-3">
          <span className="text-xs text-text-muted">
            {candidateAgents.length} candidate
            {candidateAgents.length === 1
              ? ""
              : "s"}
          </span>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pendingAgents.length === 0}
              onClick={() => setPendingAgents([])}
            >
              Clear
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelPicker}
            >
              Cancel
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={pendingAgents.length === 0}
              onClick={applyPendingAgents}
            >
              Add {pendingAgents.length}{" "}
              {pendingAgents.length === 1
                ? "Agent"
                : "Agents"}
            </Button>
          </div>
        </div>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Owns Team composition presentation and a client-side membership draft.
 * Workflow topology remains fully owned by TeamWorkflowBuilder.
 */
export function TeamMembersManager({
  team,
  onMembershipChange,
}: {
  team: Team;
  onMembershipChange?: () => void;
}) {
  const [status, setStatus] =
    useState<
      "loading" |
      "loaded" |
      "error"
    >("loading");

  const [error, setError] =
    useState<string | null>(null);

  const [mutationError, setMutationError] =
    useState<string | null>(null);

  const [agents, setAgents] =
    useState<Agent[]>([]);

  const [
    persistedAgentIds,
    setPersistedAgentIds,
  ] = useState<string[]>([]);

  const [
    draftAgentIds,
    setDraftAgentIds,
  ] = useState<string[]>([]);

  const [query, setQuery] =
    useState("");

  const [
    departmentFilter,
    setDepartmentFilter,
  ] = useState("all");

  const [view, setView] =
    useState<AgentViewMode>("table");

  const [saving, setSaving] =
    useState(false);

  /**
   * Loads persisted membership and the current Agent registry in parallel.
   */
  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setMutationError(null);

    try {
      const [
        teamMembership,
        allAgents,
      ] = await Promise.all([
        getTeamMembers(team.id),
        getAgents(),
      ]);

      const memberIds =
        teamMembership.members.map(
          (member) => member.agentId,
        );

      setAgents(allAgents);
      setPersistedAgentIds(memberIds);
      setDraftAgentIds(memberIds);
      setStatus("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [team.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const draftAgents = useMemo(
    () =>
      getVisibleTeamMemberAgents(
        agents,
        draftAgentIds,
        "",
        "all",
      ),
    [agents, draftAgentIds],
  );

  const departmentOptions = useMemo(
    () =>
      getTeamMemberDepartmentOptions(
        draftAgents,
      ),
    [draftAgents],
  );

  const effectiveDepartmentFilter =
    departmentFilter === "all" ||
    draftAgents.some(
      (agent) =>
        agent.departmentId ===
        departmentFilter,
    )
      ? departmentFilter
      : "all";

  const visibleAgents = useMemo(
    () =>
      getVisibleTeamMemberAgents(
        agents,
        draftAgentIds,
        query,
        effectiveDepartmentFilter,
      ),
    [
      agents,
      draftAgentIds,
      query,
      effectiveDepartmentFilter,
    ],
  );

  const membershipChangeCount = useMemo(
    () =>
      getMembershipChangeCount(
        persistedAgentIds,
        draftAgentIds,
      ),
    [
      persistedAgentIds,
      draftAgentIds,
    ],
  );

  const dirty =
    membershipChangeCount > 0;

  /**
   * Adds valid picker selections to the local draft without persisting them yet.
   */
  function stageAddMembers(
    selectedAgents: Agent[],
  ) {
    setDraftAgentIds((current) => {
      let next = [...current];

      for (const selectedAgent of selectedAgents) {
        const currentDraftAgents =
          getVisibleTeamMemberAgents(
            agents,
            next,
            "",
            "all",
          );

        const availability =
          getTeamMemberCandidateAvailability(
            selectedAgent,
            team.id,
            currentDraftAgents,
            [],
          );

        if (!availability.disabled) {
          next =
            appendTeamMemberAgentIds(
              next,
              [selectedAgent.id],
            );
        }
      }

      return next;
    });

    setMutationError(null);
  }

  /**
   * Stages one member removal locally so it remains recoverable until Save.
   */
  function stageRemoveMember(
    agentId: string,
  ) {
    setDraftAgentIds((current) =>
      removeTeamMemberAgentId(
        current,
        agentId,
      ),
    );

    setMutationError(null);
  }

  /**
   * Restores the last successfully persisted membership state.
   */
  function discardChanges() {
    setDraftAgentIds([
      ...persistedAgentIds,
    ]);

    setMutationError(null);
  }

  /**
   * Atomically persists the complete membership draft through the existing
   * membership-only API and preserves the draft when the request fails.
   */
  async function saveChanges() {
    if (!dirty || saving) {
      return;
    }

    setSaving(true);
    setMutationError(null);

    try {
      const next =
        await replaceTeamMembers(
          team.id,
          {
            agentIds:
              draftAgentIds,
          },
        );

      const nextMemberIds =
        next.members.map(
          (member) =>
            member.agentId,
        );

      const nextMemberIdSet =
        new Set(nextMemberIds);

      setPersistedAgentIds(
        nextMemberIds,
      );

      setDraftAgentIds(
        nextMemberIds,
      );

      setAgents((current) =>
        current.map((agent) => {
          if (
            nextMemberIdSet.has(
              agent.id,
            )
          ) {
            return {
              ...agent,
              currentTeamId:
                team.id,
            };
          }

          if (
            agent.currentTeamId ===
            team.id
          ) {
            return {
              ...agent,
              currentTeamId:
                null,
            };
          }

          return agent;
        }),
      );

      onMembershipChange?.();
    } catch (caught) {
      setMutationError(
        errorMessage(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <Empty className="min-h-[20rem] border border-border-default bg-surface-elevated">
        <Spinner className="size-6" />
        <EmptyTitle>
          Loading Team members...
        </EmptyTitle>
      </Empty>
    );
  }

  if (status === "error") {
    return (
      <Empty className="min-h-[20rem] border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>

          <EmptyTitle>
            Team members unavailable
          </EmptyTitle>

          <EmptyDescription>
            {error}
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
          >
            <RefreshCwIcon />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mutationError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {mutationError}
        </div>
      ) : null}

      <section
        aria-label="Team members"
        className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated"
      >
        <div className="flex flex-col gap-3 border-b border-divider p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex shrink-0 items-center gap-2">
            <h2 className="text-base font-semibold text-text-primary">
              Team members
            </h2>

            <Badge variant="secondary">
              {draftAgents.length}{" "}
              {draftAgents.length === 1
                ? "member"
                : "members"}
            </Badge>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <div className="relative min-w-52 flex-1 xl:max-w-72">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted"
              />

              <Input
                type="search"
                className="pl-8"
                placeholder="Search Team members..."
                aria-label="Search Team members"
                value={query}
                onChange={(event) =>
                  setQuery(
                    event.target.value,
                  )
                }
              />
            </div>

            <NativeSelect
              aria-label="Filter Team members by Department"
              value={effectiveDepartmentFilter}
              onChange={(event) =>
                setDepartmentFilter(
                  event.target.value,
                )
              }
            >
              <NativeSelectOption value="all">
                All Departments
              </NativeSelectOption>

              {departmentOptions.map(
                (department) => (
                  <NativeSelectOption
                    key={department.id}
                    value={department.id}
                  >
                    {department.name}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>

            <TeamMemberViewSwitcher
              view={view}
              onChange={setView}
            />

            <TeamMemberPicker
              team={team}
              agents={agents}
              draftAgents={draftAgents}
              disabled={saving}
              onApply={stageAddMembers}
            />
          </div>
        </div>

        {draftAgents.length === 0 ? (
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>

              <EmptyTitle>
                No Team members yet
              </EmptyTitle>

              <EmptyDescription>
                Add eligible Agents to compose this Team.
              </EmptyDescription>
            </EmptyHeader>

            {agents.length === 0 ? (
              <EmptyContent>
                <Button
                  variant="outline"
                  render={<Link href="/agents" />}
                >
                  Manage Agents
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : visibleAgents.length === 0 ? (
          <Empty className="min-h-56">
            <EmptyTitle>
              No matching Team members
            </EmptyTitle>

            <EmptyDescription>
              Try another search or Department filter.
            </EmptyDescription>
          </Empty>
        ) : view === "table" ? (
          <TeamMemberTable
            agents={visibleAgents}
            disabled={saving}
            onRemove={stageRemoveMember}
          />
        ) : view === "list" ? (
          <TeamMemberList
            agents={visibleAgents}
            disabled={saving}
            onRemove={stageRemoveMember}
          />
        ) : view === "details" ? (
          <TeamMemberDetailed
            agents={visibleAgents}
            disabled={saving}
            onRemove={stageRemoveMember}
          />
        ) : (
          <TeamMemberGrid
            agents={visibleAgents}
            disabled={saving}
            onRemove={stageRemoveMember}
          />
        )}

        <footer className="border-t border-divider px-4 py-3 text-xs text-text-muted">
          Showing {visibleAgents.length} of{" "}
          {draftAgents.length} Team members
        </footer>
      </section>

      {dirty ? (
        <div className="flex flex-col gap-3 rounded-lg border border-status-warning/50 bg-status-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangleIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-status-warning"
            />

            <div className="min-w-0">
              <p className="text-sm font-medium text-status-warning">
                {membershipChangeCount} membership{" "}
                {membershipChangeCount === 1
                  ? "change"
                  : "changes"}{" "}
                in draft
              </p>

              <p className="mt-0.5 text-xs text-text-muted">
                Changes are not persisted until you save.
                Updating Team membership can make the current
                workflow revision stale, so review the Workflow
                tab after saving.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={discardChanges}
            >
              Discard changes
            </Button>

            <Button
              type="button"
              disabled={saving}
              onClick={() => void saveChanges()}
            >
              {saving ? (
                <Spinner className="size-4" />
              ) : null}

              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
