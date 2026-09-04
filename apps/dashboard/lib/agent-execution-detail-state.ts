import type {
  AgentExecution,
  DomainEvent,
  RunMonitoringDetail,
} from "@orc/shared";

const HANDOFF_EVENT_TYPES =
  new Set([
    "route.selected",
    "workflow.transition",
    "execution.retried",
  ]);

/**
 * Returns the newest persisted execution using the same created-at ordering used by backend retry selection.
 */
function latestExecutionId(
  executions:
    AgentExecution[],
): string | null {
  if (
    executions.length ===
    0
  ) {
    return null;
  }

  return [...executions]
    .sort(
      (
        left,
        right,
      ) =>
        Date.parse(
          right.createdAt,
        ) -
        Date.parse(
          left.createdAt,
        ),
    )[0]
    ?.id ?? null;
}

/**
 * Determines whether one execution corresponds to a safe public agent in the immutable run plan.
 */
function executionMatchesPlanAgent(
  execution:
    AgentExecution,
  detail:
    RunMonitoringDetail,
): boolean {
  if (
    execution.agentId
  ) {
    return detail.executionPlan.some(
      (
        agent,
      ) =>
        agent.id ===
        execution.agentId,
    );
  }

  return detail.executionPlan.some(
    (
      agent,
    ) =>
      agent.name ===
        execution.agentName &&
      agent.role ===
        execution.agentRole &&
      agent.layer ===
        execution.layer &&
      agent.executionOrder ===
        execution.executionOrder,
  );
}

/**
 * Returns the execution's immutable workflow position without treating same-layer order as global order.
 */
export function executionPlanPosition(
  detail:
    RunMonitoringDetail,
  execution:
    AgentExecution,
): {
  step: number | null;
  total: number;
  maxLayer: number;
} {
  const planIndex =
    detail.executionPlan.findIndex(
      (
        agent,
      ) => {
        if (
          execution.agentId
        ) {
          return (
            agent.id ===
            execution.agentId
          );
        }

        return (
          agent.name ===
            execution.agentName &&
          agent.role ===
            execution.agentRole &&
          agent.layer ===
            execution.layer &&
          agent.executionOrder ===
            execution.executionOrder
        );
      },
    );

  const maxLayer =
    detail.executionPlan.reduce(
      (
        current,
        agent,
      ) =>
        Math.max(
          current,
          agent.layer,
        ),
      execution.layer,
    );

  return {
    step:
      planIndex >= 0
        ? planIndex + 1
        : null,
    total:
      detail.executionPlan
        .length,
    maxLayer,
  };
}

/**
 * Mirrors the server's supported retry boundary so historical or successful executions do not expose a fake action.
 */
export function isExecutionRetryable(
  detail:
    RunMonitoringDetail,
  execution:
    AgentExecution,
): boolean {
  if (
    detail.run.status !==
      "failed" &&
    detail.run.status !==
      "blocked"
  ) {
    return false;
  }

  if (
    detail.run
      .currentAgentId !==
    null
  ) {
    return false;
  }

  if (
    latestExecutionId(
      detail.executions,
    ) !== execution.id
  ) {
    return false;
  }

  if (
    !execution.agentId
  ) {
    return false;
  }

  return executionMatchesPlanAgent(
    execution,
    detail,
  );
}

/**
 * Selects persisted route and retry events that represent handoff activity for one execution.
 */
export function getExecutionHandoffEvents(
  detail:
    RunMonitoringDetail,
  execution:
    AgentExecution,
): DomainEvent[] {
  return detail.events
    .filter(
      (
        event,
      ) => {
        if (
          !HANDOFF_EVENT_TYPES.has(
            event.type,
          )
        ) {
          return false;
        }

        if (
          event.agentExecutionId ===
          execution.id
        ) {
          return true;
        }

        const sourceAgentId =
          event.data
            .sourceAgentId;

        return (
          typeof sourceAgentId ===
            "string" &&
          execution.agentId !==
            null &&
          sourceAgentId ===
            execution.agentId
        );
      },
    )
    .sort(
      (
        left,
        right,
      ) =>
        Date.parse(
          left.createdAt,
        ) -
        Date.parse(
          right.createdAt,
        ),
    );
}
