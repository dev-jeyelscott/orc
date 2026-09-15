"use client";

import Link from "next/link";

import { PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Agent, Team, TeamMembership } from "@orc/shared";

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
import { getAgents } from "@/lib/agents";
import { getTeamMembers, replaceTeamMembers } from "@/lib/team-membership";

/**
 * Converts one unknown Team membership failure into concise operator-facing text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Team members";
}

/**
 * Owns Team composition only -- adding/removing Agents. Workflow topology
 * (layer, order, outcome routing / the graph) is a separate resource and is
 * never written from here. Each add/remove saves immediately through the
 * membership-only API; `onMembershipChange` lets the parent tab shell
 * refresh anything else that depends on current composition.
 */
export function TeamMembersManager({
  team,
  onMembershipChange,
}: {
  team: Team;
  onMembershipChange?: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [membership, setMembership] = useState<TeamMembership | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setMutationError(null);

    try {
      const [teamMembership, allAgents] = await Promise.all([
        getTeamMembers(team.id),
        getAgents(),
      ]);

      setMembership(teamMembership);
      setAgents(allAgents);
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

  const memberAgentIds = useMemo(
    () => new Set((membership?.members ?? []).map((member) => member.agentId)),
    [membership],
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

  async function mutate(nextAgentIds: string[], agentIdBeingMutated: string) {
    setPendingAgentId(agentIdBeingMutated);
    setMutationError(null);

    try {
      const next = await replaceTeamMembers(team.id, { agentIds: nextAgentIds });
      setMembership(next);
      onMembershipChange?.();
    } catch (caught) {
      setMutationError(errorMessage(caught));
    } finally {
      setPendingAgentId(null);
    }
  }

  function addMember(agentId: string) {
    void mutate([...memberAgentIds, agentId], agentId);
  }

  function removeMember(agentId: string) {
    void mutate([...memberAgentIds].filter((id) => id !== agentId), agentId);
  }

  if (status === "loading") {
    return (
      <Empty className="min-h-[16rem] border border-border-default bg-surface-elevated">
        <Spinner className="size-6" />
        <EmptyTitle>Loading Team members...</EmptyTitle>
      </Empty>
    );
  }

  if (status === "error" || !membership) {
    return (
      <Empty className="min-h-[16rem] border border-border-default bg-surface-elevated">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>Team members unavailable</EmptyTitle>
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

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <div className="flex flex-col gap-4">
      {mutationError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mutationError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-text-primary">Current members</h3>

          {membership.members.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-text-muted">
              No Agents selected yet. Add Agents from the candidate list.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {membership.members.map((member) => (
                <li
                  key={member.agentId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border-default bg-surface-elevated p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">{member.agent.name}</p>
                    <p className="truncate text-xs text-text-muted">{member.agent.department.name}</p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={pendingAgentId === member.agentId}
                    onClick={() => removeMember(member.agentId)}
                    aria-label={`Remove ${member.agent.name} from this Team`}
                  >
                    {pendingAgentId === member.agentId ? <Spinner className="size-4" /> : <Trash2Icon />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-text-primary">Available Agents</h3>

          {candidateAgents.filter((agent) => !memberAgentIds.has(agent.id)).length === 0 ? (
            <p className="rounded-md border border-dashed border-border-default p-4 text-sm text-text-muted">
              No unassigned Agents are available.{" "}
              <Link href="/agents" className="underline">
                Create one from the Agents page.
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {candidateAgents
                .filter((agent) => !memberAgentIds.has(agent.id))
                .map((agent) => {
                  const departmentTaken = membership.members.some(
                    (member) => agentsById.get(member.agentId)?.departmentId === agent.departmentId,
                  );

                  return (
                    <li
                      key={agent.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-default bg-surface-elevated p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">{agent.name}</p>
                        <p className="truncate text-xs text-text-muted">{agent.department.name}</p>
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={departmentTaken || pendingAgentId === agent.id}
                        onClick={() => addMember(agent.id)}
                        title={departmentTaken ? `${agent.department.name} is already represented` : undefined}
                      >
                        {pendingAgentId === agent.id ? <Spinner className="size-4" /> : <PlusIcon />}
                        Add
                      </Button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
