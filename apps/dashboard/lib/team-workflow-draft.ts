import type {
  Agent,
  AgentRouteOutcome,
  TerminalAction,
  TeamWorkflowInput,
} from "@orc/shared";

export const WORKFLOW_OUTCOMES: readonly AgentRouteOutcome[] = [
  "completed",
  "approved",
  "changes_requested",
  "blocked",
  "failed",
];

export const EXCEPTIONAL_OUTCOMES: readonly AgentRouteOutcome[] = [
  "changes_requested",
  "blocked",
  "failed",
];

/**
 * One outcome route as edited in the deterministic Workflow tab form.
 * "default" is only valid for `completed`/`approved` and means "let the
 * runtime advance to the next ordered member, or complete the Run".
 */
export type DraftRouteMode =
  | "default"
  | "agent"
  | TerminalAction;

export type DraftRoute = {
  outcome: AgentRouteOutcome;
  mode: DraftRouteMode;
  targetAgentId: string | null;
};

export type DraftMember = {
  agentId: string;
  layer: number;
  executionOrder: number;
  routes: DraftRoute[];
};

/**
 * Builds the default route set for a newly added Team member: default
 * progression for completed/approved, and an unset placeholder for every
 * exceptional outcome that must be configured before the workflow is runnable.
 */
export function createDefaultRoutes(): DraftRoute[] {
  return WORKFLOW_OUTCOMES.map((outcome) => ({
    outcome,
    mode: outcome === "completed" || outcome === "approved"
      ? "default"
      : "block_run",
    targetAgentId: null,
  }));
}

/**
 * Orders draft members by layer ascending, then same-layer execution order.
 */
export function orderDraftMembers(
  members: readonly DraftMember[],
): DraftMember[] {
  return [...members].sort(
    (left, right) =>
      left.layer - right.layer || left.executionOrder - right.executionOrder,
  );
}

/**
 * Computes the Agent a `completed`/`approved` outcome falls through to by
 * default given the current unsaved layer/order draft: the next ordered
 * member, or null when this member is last (the Run would complete).
 */
export function computeDefaultNextAgentId(
  members: readonly DraftMember[],
  agentId: string,
): string | null {
  const ordered = orderDraftMembers(members);
  const index = ordered.findIndex((member) => member.agentId === agentId);

  if (index === -1) {
    return null;
  }

  return ordered[index + 1]?.agentId ?? null;
}

export type DraftValidationIssue = {
  agentId?: string;
  message: string;
};

/**
 * Validates a Team workflow draft against every save-time invariant so the
 * operator sees problems before attempting the atomic save.
 */
export function validateDraft(
  members: readonly DraftMember[],
  agentsById: ReadonlyMap<string, Agent>,
): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  const seenDepartments = new Map<string, string>();
  const seenPlacements = new Map<string, string>();
  const agentIds = new Set(members.map((member) => member.agentId));

  for (const member of members) {
    const agent = agentsById.get(member.agentId);

    if (!agent) {
      issues.push({
        agentId: member.agentId,
        message: "Selected Agent is no longer available",
      });

      continue;
    }

    const existingDepartmentAgentId = seenDepartments.get(
      agent.departmentId,
    );

    if (
      existingDepartmentAgentId &&
      existingDepartmentAgentId !== member.agentId
    ) {
      issues.push({
        agentId: member.agentId,
        message: `${agent.department.name} is already represented by another Agent`,
      });
    } else {
      seenDepartments.set(agent.departmentId, member.agentId);
    }

    const placementKey = `${member.layer}:${member.executionOrder}`;
    const existingPlacementAgentId = seenPlacements.get(placementKey);

    if (
      existingPlacementAgentId &&
      existingPlacementAgentId !== member.agentId
    ) {
      issues.push({
        agentId: member.agentId,
        message: `Layer ${member.layer}, order ${member.executionOrder} is already assigned to another Agent`,
      });
    } else {
      seenPlacements.set(placementKey, member.agentId);
    }

    for (const outcome of EXCEPTIONAL_OUTCOMES) {
      const route = member.routes.find((candidate) => candidate.outcome === outcome);

      if (!route || route.mode === "default") {
        issues.push({
          agentId: member.agentId,
          message: `Missing a required route for "${outcome}"`,
        });
      }
    }

    for (const route of member.routes) {
      if (route.mode === "agent" && !route.targetAgentId) {
        issues.push({
          agentId: member.agentId,
          message: `Select a target Agent for the "${route.outcome}" route`,
        });
      }

      if (
        route.mode === "agent" &&
        route.targetAgentId &&
        !agentIds.has(route.targetAgentId)
      ) {
        issues.push({
          agentId: member.agentId,
          message: `The "${route.outcome}" route targets an Agent outside this Team`,
        });
      }
    }
  }

  return issues;
}

/**
 * Converts a validated draft into the atomic Team workflow save payload.
 */
export function buildWorkflowInput(
  members: readonly DraftMember[],
): TeamWorkflowInput {
  return {
    members: members.map((member) => ({
      agentId: member.agentId,
      layer: member.layer,
      executionOrder: member.executionOrder,
      routes: member.routes
        .filter((route) => route.mode !== "default")
        .map((route) => ({
          outcome: route.outcome,
          targetAgentId: route.mode === "agent" ? route.targetAgentId : null,
          terminalAction:
            route.mode === "agent" || route.mode === "default"
              ? null
              : route.mode,
        })),
    })),
  };
}
