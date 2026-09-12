import type {
  AgentWithRoutes,
} from "@orc/shared";

import type {
  AgentStatusFilter,
} from "./agent-presentation";

export const TEAM_AGENT_VIEW_MODES = [
  "table",
  "list",
  "details",
  "grid",
] as const;

export type TeamAgentViewMode =
  (typeof TEAM_AGENT_VIEW_MODES)[number];

export type TeamAgentSortKey =
  | "name"
  | "workflow"
  | "updatedAt";

export type TeamRouteRow = {
  id: string;
  sourceAgentId: string;
  sourceName: string;
  outcome: string;
  destination: string;
  terminal: boolean;
  enabled: boolean;
};

const agentCollator = new Intl.Collator(
  undefined,
  {
    numeric: true,
    sensitivity: "base",
  },
);

/**
 * Orders Agents using the runtime's generic layer and same-layer execution-order contract.
 */
export function compareWorkflowAgents(
  left: AgentWithRoutes,
  right: AgentWithRoutes,
): number {
  return (
    left.layer - right.layer ||
    left.executionOrder - right.executionOrder ||
    agentCollator.compare(
      left.name,
      right.name,
    ) ||
    agentCollator.compare(
      left.id,
      right.id,
    )
  );
}

/**
 * Returns a new deterministic workflow-ordered Agent array without mutating API state.
 */
export function getWorkflowOrderedAgents(
  agents: AgentWithRoutes[],
): AgentWithRoutes[] {
  return [
    ...agents,
  ].sort(
    compareWorkflowAgents,
  );
}

/**
 * Filters and sorts one Team's Agent collection for every collection view.
 */
export function getVisibleTeamAgents(
  agents: AgentWithRoutes[],
  query: string,
  layer: number | null,
  status: AgentStatusFilter,
  sortKey: TeamAgentSortKey,
): AgentWithRoutes[] {
  const normalizedQuery =
    query.trim().toLowerCase();

  return agents
    .filter((agent) => {
      if (
        layer !== null &&
        agent.layer !== layer
      ) {
        return false;
      }

      if (
        status === "enabled" &&
        !agent.enabled
      ) {
        return false;
      }

      if (
        status === "disabled" &&
        agent.enabled
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        agent.name,
        agent.slug,
        agent.effective.role,
        agent.effective.model,
        agent.effective.harness,
        agent.effective.reasoning,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice()
    .sort((left, right) => {
      if (sortKey === "workflow") {
        return compareWorkflowAgents(
          left,
          right,
        );
      }

      if (sortKey === "updatedAt") {
        const updatedComparison =
          Date.parse(right.updatedAt) -
          Date.parse(left.updatedAt);

        if (
          Number.isFinite(
            updatedComparison,
          ) &&
          updatedComparison !== 0
        ) {
          return updatedComparison;
        }
      }

      return (
        agentCollator.compare(
          left.name,
          right.name,
        ) ||
        agentCollator.compare(
          left.id,
          right.id,
        )
      );
    });
}

/**
 * Converts persisted capability booleans into concise operator-facing labels.
 */
export function getAgentCapabilityLabels(
  agent: AgentWithRoutes,
): string[] {
  const capabilities: string[] = [];

  if (agent.effective.canWrite) {
    capabilities.push("Write");
  }

  if (agent.effective.canRunCommands) {
    capabilities.push("Commands");
  }

  if (agent.effective.canCommit) {
    capabilities.push("Commit");
  }

  return capabilities.length > 0
    ? capabilities
    : ["Read only"];
}

/**
 * Counts distinct configured workflow layers without implying runtime activity.
 */
export function countConfiguredLayers(
  agents: AgentWithRoutes[],
): number {
  return new Set(
    agents.map(
      (agent) =>
        agent.layer,
    ),
  ).size;
}

/**
 * Flattens persisted explicit Agent routes into deterministic Team-local table rows.
 */
export function getTeamRouteRows(
  agents: AgentWithRoutes[],
): TeamRouteRow[] {
  const orderedAgents =
    getWorkflowOrderedAgents(
      agents,
    );
  const agentsById =
    new Map(
      agents.map(
        (agent) => [
          agent.id,
          agent,
        ]),
    );

  return orderedAgents.flatMap(
    (source) =>
      [...source.routes]
        .sort((left, right) =>
          agentCollator.compare(
            left.outcome,
            right.outcome,
          ) ||
          agentCollator.compare(
            left.id,
            right.id,
          ),
        )
        .map((route) => ({
          id: route.id,
          sourceAgentId:
            source.id,
          sourceName:
            source.name,
          outcome:
            route.outcome,
          destination:
            route.targetAgentId
              ? agentsById.get(
                  route.targetAgentId,
                )?.name ??
                "Unavailable Agent"
              : route.terminalAction ??
                "Unavailable",
          terminal:
            route.targetAgentId === null &&
            route.terminalAction !== null,
          enabled:
            route.enabled,
        })),
  );
}
