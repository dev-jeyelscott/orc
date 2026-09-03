import type {
  AgentMonitoringRange,
  AgentRouteOutcome,
  AgentWithRoutes,
  DomainEvent,
  TerminalAction,
} from "@orc/shared";

export const AGENT_TIME_RANGE_OPTIONS: Array<{
  value:
    AgentMonitoringRange;
  label: string;
}> = [
  {
    value: "24h",
    label:
      "Last 24 hours",
  },
  {
    value: "7d",
    label:
      "Last 7 days",
  },
  {
    value: "30d",
    label:
      "Last 30 days",
  },
];

export type AgentStatusFilter =
  | "all"
  | "enabled"
  | "disabled";

export type AgentLayerGroup = {
  layer: number;
  agents:
    AgentWithRoutes[];
};

export type AgentRouteHealth = {
  enabledAgentTargets:
    number;
  enabledTerminalRoutes:
    number;
  disabledRoutes:
    number;
  total: number;
};

export type AgentWorkflowEdge = {
  id: string;
  kind:
    | "default"
    | "explicit";
  sourceAgentId:
    string;
  targetAgentId:
    | string
    | null;
  terminalAction:
    | TerminalAction
    | null;
  outcome:
    | AgentRouteOutcome
    | null;
  enabled: boolean;
  active: boolean;
};

/**
 * Orders agents using the exact generic layer and same-layer ordering contract.
 */
function compareAgents(
  left:
    AgentWithRoutes,
  right:
    AgentWithRoutes,
): number {
  return (
    left.layer -
      right.layer ||
    left.executionOrder -
      right.executionOrder
  );
}

/**
 * Groups current agent configuration by numeric workflow layer.
 */
export function groupAgentsByLayer(
  agents:
    AgentWithRoutes[],
): AgentLayerGroup[] {
  const groups =
    new Map<
      number,
      AgentWithRoutes[]
    >();

  for (const agent of [
    ...agents,
  ].sort(compareAgents)) {
    const existing =
      groups.get(
        agent.layer,
      ) ?? [];

    existing.push(agent);

    groups.set(
      agent.layer,
      existing,
    );
  }

  return [
    ...groups.entries(),
  ]
    .sort(
      (
        [left],
        [right],
      ) =>
        left - right,
    )
    .map(
      ([layer, values]) => ({
        layer,
        agents:
          values,
      }),
    );
}

/**
 * Filters agents by operator search text, layer, and enabled state.
 */
export function filterAgents(
  agents:
    AgentWithRoutes[],
  search: string,
  layer:
    number | null,
  status:
    AgentStatusFilter,
): AgentWithRoutes[] {
  const query =
    search
      .trim()
      .toLowerCase();

  return agents.filter(
    (agent) => {
      if (
        layer !== null &&
        agent.layer !==
          layer
      ) {
        return false;
      }

      if (
        status ===
          "enabled" &&
        !agent.enabled
      ) {
        return false;
      }

      if (
        status ===
          "disabled" &&
        agent.enabled
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        agent.name,
        agent.role,
        agent.slug,
      ].some((value) =>
        value
          .toLowerCase()
          .includes(
            query,
          ),
      );
    },
  );
}

/**
 * Calculates the requested approval ratio without treating other result statuses as reviews.
 */
export function calculateApprovalRate(
  approved: number,
  changesRequested:
    number,
): number | null {
  const denominator =
    approved +
    changesRequested;

  return denominator > 0
    ? (approved /
        denominator) *
        100
    : null;
}

/**
 * Calculates generic successful-result percentage from authoritative persisted result counts.
 */
export function calculateResultSuccessRate(
  successfulResults:
    number,
  resultCount: number,
): number | null {
  return resultCount > 0
    ? (successfulResults /
        resultCount) *
        100
    : null;
}

/**
 * Partitions persisted routes into mutually exclusive health categories.
 */
export function calculateRouteHealth(
  agents:
    AgentWithRoutes[],
): AgentRouteHealth {
  let enabledAgentTargets =
    0;

  let enabledTerminalRoutes =
    0;

  let disabledRoutes =
    0;

  for (const agent of agents) {
    for (
      const route of
      agent.routes
    ) {
      if (!route.enabled) {
        disabledRoutes += 1;
      } else if (
        route.targetAgentId
      ) {
        enabledAgentTargets +=
          1;
      } else {
        enabledTerminalRoutes +=
          1;
      }
    }
  }

  return {
    enabledAgentTargets,
    enabledTerminalRoutes,
    disabledRoutes,
    total:
      enabledAgentTargets +
      enabledTerminalRoutes +
      disabledRoutes,
  };
}

/**
 * Derives the read-only normal workflow sequence plus every persisted explicit route.
 */
export function deriveWorkflowEdges(
  agents:
    AgentWithRoutes[],
): AgentWorkflowEdge[] {
  const orderedEnabled =
    [...agents]
      .filter(
        (agent) =>
          agent.enabled,
      )
      .sort(
        compareAgents,
      );

  const agentsById =
    new Map(
      agents.map(
        (agent) => [
          agent.id,
          agent,
        ],
      ),
    );

  const edges:
    AgentWorkflowEdge[] =
    [];

  for (
    let index = 0;
    index <
    orderedEnabled.length - 1;
    index += 1
  ) {
    const source =
      orderedEnabled[index];

    const target =
      orderedEnabled[
        index + 1
      ];

    edges.push({
      id:
        `default:${source.id}:${target.id}`,
      kind:
        "default",
      sourceAgentId:
        source.id,
      targetAgentId:
        target.id,
      terminalAction:
        null,
      outcome: null,
      enabled: true,
      active: true,
    });
  }

  for (const source of agents) {
    for (
      const route of
      source.routes
    ) {
      const target =
        route.targetAgentId
          ? agentsById.get(
              route.targetAgentId,
            ) ?? null
          : null;

      edges.push({
        id:
          `explicit:${route.id}`,
        kind:
          "explicit",
        sourceAgentId:
          source.id,
        targetAgentId:
          route.targetAgentId,
        terminalAction:
          route.terminalAction,
        outcome:
          route.outcome,
        enabled:
          route.enabled,
        active:
          route.enabled &&
          source.enabled &&
          (
            !target ||
            target.enabled
          ),
      });
    }
  }

  return edges;
}

/**
 * Resolves one current agent identifier to a readable name without assuming any role names.
 */
function agentName(
  agents:
    AgentWithRoutes[],
  id: unknown,
): string | null {
  if (
    typeof id !==
    "string"
  ) {
    return null;
  }

  return (
    agents.find(
      (agent) =>
        agent.id === id,
    )?.name ?? null
  );
}

/**
 * Converts a persisted domain event into a concise generic Agents-page description.
 */
export function describeAgentMonitoringEvent(
  event:
    DomainEvent,
  agents:
    AgentWithRoutes[],
): string {
  if (
    event.type ===
    "agent.started"
  ) {
    const name =
      agentName(
        agents,
        event.data.agentId,
      );

    return name
      ? `${name} started`
      : "Agent started";
  }

  if (
    event.type ===
    "workflow.transition"
  ) {
    const source =
      agentName(
        agents,
        event.data
          .sourceAgentId,
      ) ??
      "Agent";

    const target =
      agentName(
        agents,
        event.data
          .targetAgentId,
      );

    if (target) {
      return `${source} routed to ${target}`;
    }

    const terminal =
      event.data
        .terminalAction;

    return typeof terminal ===
      "string"
      ? `${source} routed to ${formatIdentifier(
          terminal,
        )}`
      : "Workflow transition";
  }

  if (
    event.type ===
    "route.selected"
  ) {
    const target =
      agentName(
        agents,
        event.data
          .targetAgentId,
      );

    return target
      ? `Explicit route selected to ${target}`
      : "Explicit route selected";
  }

  if (
    event.type ===
    "result.received"
  ) {
    const status =
      event.data.status;

    return typeof status ===
      "string"
      ? `Result received: ${formatIdentifier(
          status,
        )}`
      : "Result received";
  }

  return formatIdentifier(
    event.type,
  );
}

/**
 * Converts a persisted identifier into a compact readable label.
 */
export function formatIdentifier(
  value: string,
): string {
  return value
    .replaceAll(
      /[._-]+/g,
      " ",
    )
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

/**
 * Formats a byte count using binary operator-friendly units.
 */
export function formatBytes(
  value:
    number | null,
): string {
  if (
    value === null ||
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    return "Unavailable";
  }

  if (value < 1024) {
    return `${Math.round(
      value,
    )} B`;
  }

  const units = [
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let current =
    value / 1024;

  let unitIndex = 0;

  while (
    current >= 1024 &&
    unitIndex <
      units.length - 1
  ) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(
    current >= 100
      ? 0
      : current >= 10
        ? 1
        : 2,
  )} ${units[unitIndex]}`;
}
