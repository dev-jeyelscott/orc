import type { Agent } from "@orc/shared";

const agentCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export type TeamMemberDepartmentOption = {
  id: string;
  name: string;
};

export type TeamMemberCandidateAvailability = {
  disabled: boolean;
  reason: string | null;
};

/**
 * Orders Team-member Agents deterministically for presentation only.
 * Workflow execution order is owned by the Workflow graph, not this collection.
 */
export function compareTeamMemberAgents(
  left: Agent,
  right: Agent,
): number {
  return (
    agentCollator.compare(left.name, right.name) ||
    agentCollator.compare(left.id, right.id)
  );
}

/**
 * Builds the searchable presentation text for one Agent.
 */
export function getTeamMemberAgentSearchText(
  agent: Agent,
): string {
  return [
    agent.name,
    agent.slug,
    agent.department.name,
    agent.effective.role,
    agent.effective.harness,
    agent.effective.model,
    agent.effective.reasoning,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Returns the current draft members after applying presentation-only search
 * and Department filtering.
 */
export function getVisibleTeamMemberAgents(
  agents: readonly Agent[],
  draftAgentIds: readonly string[],
  query: string,
  departmentId: string,
): Agent[] {
  const selectedIds = new Set(draftAgentIds);
  const normalizedQuery = query.trim().toLowerCase();

  return agents
    .filter((agent) => selectedIds.has(agent.id))
    .filter(
      (agent) =>
        departmentId === "all" ||
        agent.departmentId === departmentId,
    )
    .filter(
      (agent) =>
        !normalizedQuery ||
        getTeamMemberAgentSearchText(agent).includes(normalizedQuery),
    )
    .slice()
    .sort(compareTeamMemberAgents);
}

/**
 * Returns every non-draft Agent for the Add Agents picker.
 * Agents owned by another Team remain present so the UI can explain why
 * they are unavailable instead of silently hiding them.
 */
export function getTeamMemberCandidateAgents(
  agents: readonly Agent[],
  draftAgentIds: readonly string[],
): Agent[] {
  const selectedIds = new Set(draftAgentIds);

  return agents
    .filter((agent) => !selectedIds.has(agent.id))
    .slice()
    .sort(compareTeamMemberAgents);
}

/**
 * Determines whether one picker candidate may be selected against the
 * current membership draft and the still-unapplied picker selection.
 */
export function getTeamMemberCandidateAvailability(
  agent: Agent,
  currentTeamId: string,
  draftAgents: readonly Agent[],
  pendingAgents: readonly Agent[],
): TeamMemberCandidateAvailability {
  if (
    agent.currentTeamId !== null &&
    agent.currentTeamId !== currentTeamId
  ) {
    return {
      disabled: true,
      reason: "Assigned to another Team",
    };
  }

  const representedBy = [...draftAgents, ...pendingAgents].find(
    (otherAgent) =>
      otherAgent.id !== agent.id &&
      otherAgent.departmentId === agent.departmentId,
  );

  if (representedBy) {
    return {
      disabled: true,
      reason: `${agent.department.name} already represented`,
    };
  }

  return {
    disabled: false,
    reason: null,
  };
}

/**
 * Returns the unique Department options represented by the current draft.
 */
export function getTeamMemberDepartmentOptions(
  agents: readonly Agent[],
): TeamMemberDepartmentOption[] {
  const byId = new Map<string, TeamMemberDepartmentOption>();

  for (const agent of agents) {
    byId.set(agent.departmentId, {
      id: agent.departmentId,
      name: agent.department.name,
    });
  }

  return [...byId.values()].sort(
    (left, right) =>
      agentCollator.compare(left.name, right.name) ||
      agentCollator.compare(left.id, right.id),
  );
}

/**
 * Counts membership additions and removals between persisted and draft state.
 */
export function getMembershipChangeCount(
  persistedAgentIds: readonly string[],
  draftAgentIds: readonly string[],
): number {
  const persisted = new Set(persistedAgentIds);
  const draft = new Set(draftAgentIds);

  let changes = 0;

  for (const agentId of persisted) {
    if (!draft.has(agentId)) {
      changes += 1;
    }
  }

  for (const agentId of draft) {
    if (!persisted.has(agentId)) {
      changes += 1;
    }
  }

  return changes;
}

/**
 * Reports whether the membership draft differs from persisted membership.
 */
export function hasMembershipChanges(
  persistedAgentIds: readonly string[],
  draftAgentIds: readonly string[],
): boolean {
  return getMembershipChangeCount(
    persistedAgentIds,
    draftAgentIds,
  ) > 0;
}

/**
 * Appends Agent IDs without introducing duplicate Team members.
 */
export function appendTeamMemberAgentIds(
  currentAgentIds: readonly string[],
  addedAgentIds: readonly string[],
): string[] {
  const next = [...currentAgentIds];
  const seen = new Set(next);

  for (const agentId of addedAgentIds) {
    if (!seen.has(agentId)) {
      next.push(agentId);
      seen.add(agentId);
    }
  }

  return next;
}

/**
 * Removes one Agent ID from a membership draft without mutating the source.
 */
export function removeTeamMemberAgentId(
  currentAgentIds: readonly string[],
  removedAgentId: string,
): string[] {
  return currentAgentIds.filter(
    (agentId) => agentId !== removedAgentId,
  );
}
