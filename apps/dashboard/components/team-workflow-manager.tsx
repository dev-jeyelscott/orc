"use client";

import { AlertTriangleIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Agent, Team, TeamWorkflow } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAgents } from "@/lib/agents";
import {
  EXCEPTIONAL_OUTCOMES,
  WORKFLOW_OUTCOMES,
  buildWorkflowInput,
  computeDefaultNextAgentId,
  createDefaultRoutes,
  orderDraftMembers,
  validateDraft,
  type DraftMember,
  type DraftRoute,
  type DraftRouteMode,
} from "@/lib/team-workflow-draft";
import { getTeamWorkflow, replaceTeamWorkflow } from "@/lib/team-workflow";

const OUTCOME_LABELS: Record<string, string> = {
  completed: "completed",
  approved: "approved",
  changes_requested: "changes requested",
  blocked: "blocked",
  failed: "failed",
};

/**
 * Converts one unknown Team workflow failure into concise operator-facing text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Team workflow";
}

/**
 * Builds draft members from the persisted Team workflow, translating each
 * persisted route into the deterministic form's route mode.
 */
function draftFromWorkflow(workflow: TeamWorkflow): DraftMember[] {
  return workflow.members.map((member) => {
    const routes: DraftRoute[] = WORKFLOW_OUTCOMES.map((outcome) => {
      const persisted = member.routes.find((route) => route.outcome === outcome);

      if (!persisted) {
        return { outcome, mode: "default" as DraftRouteMode, targetAgentId: null };
      }

      if (persisted.targetAgentId) {
        return {
          outcome,
          mode: "agent" as DraftRouteMode,
          targetAgentId: persisted.targetAgentId,
        };
      }

      return {
        outcome,
        mode: (persisted.terminalAction ?? "block_run") as DraftRouteMode,
        targetAgentId: null,
      };
    });

    return {
      agentId: member.agentId,
      layer: member.layer,
      executionOrder: member.executionOrder,
      routes,
    };
  });
}

/**
 * Returns the next free layer for a newly added Team member, defaulting to
 * one layer past the current highest configured layer.
 */
function nextAvailableLayer(members: readonly DraftMember[]): number {
  return members.reduce((max, member) => Math.max(max, member.layer), 0) + 1;
}

/**
 * Loads one Team's workflow together with every candidate Agent, and lets the
 * operator compose Team membership, layer/order placement, and outcome
 * routing as one atomic draft saved through the Team workflow resource.
 */
export function TeamWorkflowManager({ team }: { team: Team }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setSaveError(null);

    try {
      const [workflow, allAgents] = await Promise.all([
        getTeamWorkflow(team.id),
        getAgents(),
      ]);

      setAgents(allAgents);
      setMembers(draftFromWorkflow(workflow));
      setDirty(false);
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

  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const memberAgentIds = useMemo(
    () => new Set(members.map((member) => member.agentId)),
    [members],
  );

  const candidateAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.currentTeamId === null ||
          agent.currentTeamId === team.id ||
          memberAgentIds.has(agent.id),
      ),
    [agents, team.id, memberAgentIds],
  );

  const orderedMembers = useMemo(() => orderDraftMembers(members), [members]);

  const validationIssues = useMemo(
    () => validateDraft(members, agentsById),
    [members, agentsById],
  );

  /**
   * Adds one candidate Agent as a new Team member with default routing and
   * the next free layer.
   */
  function addMember(agentId: string) {
    setMembers((current) => [
      ...current,
      {
        agentId,
        layer: nextAvailableLayer(current),
        executionOrder: 1,
        routes: createDefaultRoutes(),
      },
    ]);
    setDirty(true);
  }

  /**
   * Removes one Team member from the draft and resets any other member's
   * route that targeted it, so the save can never leave a dangling route.
   */
  function removeMember(agentId: string) {
    setMembers((current) =>
      current
        .filter((member) => member.agentId !== agentId)
        .map((member) => ({
          ...member,
          routes: member.routes.map((route) =>
            route.mode === "agent" && route.targetAgentId === agentId
              ? { ...route, mode: "block_run" as DraftRouteMode, targetAgentId: null }
              : route,
          ),
        })),
    );
    setDirty(true);
  }

  /**
   * Updates one member's layer or execution-order placement.
   */
  function updatePlacement(agentId: string, field: "layer" | "executionOrder", value: number) {
    setMembers((current) =>
      current.map((member) =>
        member.agentId === agentId
          ? { ...member, [field]: Number.isFinite(value) && value >= 1 ? value : 1 }
          : member,
      ),
    );
    setDirty(true);
  }

  /**
   * Updates one member's route for a single outcome.
   */
  function updateRoute(
    agentId: string,
    outcome: string,
    mode: DraftRouteMode,
    targetAgentId: string | null,
  ) {
    setMembers((current) =>
      current.map((member) =>
        member.agentId === agentId
          ? {
              ...member,
              routes: member.routes.map((route) =>
                route.outcome === outcome ? { ...route, mode, targetAgentId } : route,
              ),
            }
          : member,
      ),
    );
    setDirty(true);
  }

  /**
   * Validates the complete draft, then atomically saves it through the Team
   * workflow resource. Preserves the draft on a failed save.
   */
  async function save() {
    if (validationIssues.length > 0) {
      setSaveError("Resolve the highlighted issues before saving.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const workflow = await replaceTeamWorkflow(team.id, buildWorkflowInput(members));

      setMembers(draftFromWorkflow(workflow));
      setDirty(false);
    } catch (caught) {
      setSaveError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <Empty className="min-h-[24rem] border border-border-default bg-surface-elevated">
        <Spinner className="size-6" />
        <EmptyTitle>Loading Team workflow...</EmptyTitle>
      </Empty>
    );
  }

  if (status === "error") {
    return (
      <Empty className="min-h-[24rem] border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>Workflow unavailable</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCwIcon />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const issuesByAgentId = new Map<string, string[]>();

  for (const issue of validationIssues) {
    if (!issue.agentId) continue;
    const existing = issuesByAgentId.get(issue.agentId) ?? [];
    existing.push(issue.message);
    issuesByAgentId.set(issue.agentId, existing);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {validationIssues.length > 0 ? (
            <Badge variant="warning">
              <AlertTriangleIcon className="size-3.5" />
              {validationIssues.length} issue{validationIssues.length === 1 ? "" : "s"}
            </Badge>
          ) : (
            <Badge variant={members.length ? "success" : "disabled"}>
              {members.length ? "Runnable" : "No members"}
            </Badge>
          )}
          {dirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
        </div>

        <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Spinner className="size-4" /> : null}
          Save workflow
        </Button>
      </div>

      {saveError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="mt-3">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-text-primary">Current members</h3>

              {orderedMembers.length === 0 ? (
                <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-text-muted">
                  No Agents selected yet. Add Agents from the candidate list.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {orderedMembers.map((member) => {
                    const agent = agentsById.get(member.agentId);
                    const issues = issuesByAgentId.get(member.agentId) ?? [];

                    return (
                      <li
                        key={member.agentId}
                        className="flex items-center justify-between gap-3 rounded-md border border-border-default bg-surface-elevated p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">
                            {agent?.name ?? "Unavailable Agent"}
                          </p>
                          <p className="truncate text-xs text-text-muted">
                            {agent?.department.name ?? "Unknown Department"} · L{member.layer} #
                            {member.executionOrder}
                          </p>
                          {issues.length > 0 ? (
                            <p className="mt-1 text-xs text-destructive">{issues[0]}</p>
                          ) : null}
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeMember(member.agentId)}
                          aria-label={`Remove ${agent?.name ?? "Agent"} from this Team`}
                        >
                          <Trash2Icon />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-text-primary">Available Agents</h3>

              {candidateAgents.filter((agent) => !memberAgentIds.has(agent.id)).length === 0 ? (
                <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-text-muted">
                  No unassigned Agents are available. Create one from the Agents page.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {candidateAgents
                    .filter((agent) => !memberAgentIds.has(agent.id))
                    .map((agent) => {
                      const departmentTaken = members.some(
                        (member) =>
                          agentsById.get(member.agentId)?.departmentId === agent.departmentId,
                      );

                      return (
                        <li
                          key={agent.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border-default bg-surface-elevated p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {agent.name}
                            </p>
                            <p className="truncate text-xs text-text-muted">
                              {agent.department.name}
                            </p>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={departmentTaken}
                            onClick={() => addMember(agent.id)}
                            title={
                              departmentTaken
                                ? `${agent.department.name} is already represented`
                                : undefined
                            }
                          >
                            <PlusIcon />
                            Add
                          </Button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="workflow" className="mt-3">
          {orderedMembers.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-text-muted">
              Add Agents on the Agents tab before configuring layer, order, and routing.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {orderedMembers.map((member) => {
                const agent = agentsById.get(member.agentId);
                const defaultNextAgentId = computeDefaultNextAgentId(members, member.agentId);
                const defaultNextLabel = defaultNextAgentId
                  ? (agentsById.get(defaultNextAgentId)?.name ?? "Unavailable Agent")
                  : "Complete Run";

                return (
                  <div
                    key={member.agentId}
                    className="rounded-md border border-border-default bg-surface-elevated p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {agent?.name ?? "Unavailable Agent"}
                        </p>
                        <p className="text-xs text-text-muted">
                          {agent?.department.name ?? "Unknown Department"} ·{" "}
                          {agent?.effective.role ?? "Unknown role"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-text-muted">
                          Layer
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-16"
                            value={member.layer}
                            onChange={(event) =>
                              updatePlacement(
                                member.agentId,
                                "layer",
                                Number(event.target.value),
                              )
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-text-muted">
                          Order
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-16"
                            value={member.executionOrder}
                            onChange={(event) =>
                              updatePlacement(
                                member.agentId,
                                "executionOrder",
                                Number(event.target.value),
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-2">
                      {member.routes.map((route) => {
                        const isDefaultable =
                          route.outcome === "completed" || route.outcome === "approved";

                        return (
                          <div
                            key={route.outcome}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2"
                          >
                            <span className="text-xs font-medium text-text-primary">
                              {OUTCOME_LABELS[route.outcome] ?? route.outcome}
                              {EXCEPTIONAL_OUTCOMES.includes(route.outcome) ? (
                                <span className="ml-1 text-destructive">*</span>
                              ) : null}
                            </span>

                            <div className="flex items-center gap-2">
                              <NativeSelect
                                aria-label={`Route for ${route.outcome}`}
                                className="h-8 min-w-40"
                                value={
                                  route.mode === "agent"
                                    ? `agent:${route.targetAgentId ?? ""}`
                                    : route.mode
                                }
                                onChange={(event) => {
                                  const raw = event.target.value;

                                  if (raw.startsWith("agent:")) {
                                    updateRoute(
                                      member.agentId,
                                      route.outcome,
                                      "agent",
                                      raw.slice("agent:".length),
                                    );
                                    return;
                                  }

                                  updateRoute(
                                    member.agentId,
                                    route.outcome,
                                    raw as DraftRouteMode,
                                    null,
                                  );
                                }}
                              >
                                {isDefaultable ? (
                                  <NativeSelectOption value="default">
                                    Default next ({defaultNextLabel})
                                  </NativeSelectOption>
                                ) : null}
                                {orderedMembers
                                  .filter((candidate) => candidate.agentId !== member.agentId)
                                  .map((candidate) => (
                                    <NativeSelectOption
                                      key={candidate.agentId}
                                      value={`agent:${candidate.agentId}`}
                                    >
                                      Route to {agentsById.get(candidate.agentId)?.name ?? "Agent"}
                                    </NativeSelectOption>
                                  ))}
                                <NativeSelectOption value="complete_run">
                                  Complete Run
                                </NativeSelectOption>
                                <NativeSelectOption value="block_run">
                                  Block Run
                                </NativeSelectOption>
                                <NativeSelectOption value="fail_run">Fail Run</NativeSelectOption>
                              </NativeSelect>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
