import type {
  DomainEvent,
} from "@orc/shared";

export type EventBadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

/**
 * Reads one string event-data field without assuming provider-specific payload structure.
 */
function eventString(
  event: DomainEvent,
  key: string,
): string | null {
  const value =
    event.data[key];

  return typeof value ===
    "string"
    ? value
    : null;
}

/**
 * Reads one finite numeric event-data field without coercing unknown payload values.
 */
function eventNumber(
  event: DomainEvent,
  key: string,
): number | null {
  const value =
    event.data[key];

  return typeof value ===
      "number" &&
    Number.isFinite(
      value,
    )
    ? value
    : null;
}

/**
 * Creates a concise operator description from persisted domain-event fields only.
 */
export function describeDomainEvent(
  event: DomainEvent,
): string {
  switch (
    event.type
  ) {
    case "run.started":
      return eventString(
        event,
        "title",
      )
        ? `Run started for ${eventString(event, "title")}`
        : "Run started";

    case "agent.started": {
      const layer =
        eventNumber(
          event,
          "layer",
        );

      return layer ===
        null
        ? "Agent execution started"
        : `Agent execution started on layer ${layer}`;
    }

    case "result.received":
      return eventString(
        event,
        "status",
      )
        ? `Structured result received: ${eventString(event, "status")}`
        : "Structured result received";

    case "route.selected":
      return eventString(
        event,
        "outcome",
      )
        ? `Workflow route selected after ${eventString(event, "outcome")}`
        : "Workflow route selected";

    case "execution.retried":
      return "Execution retry requested";

    case "run.completed":
      return "Run completed";

    case "run.blocked":
      return "Run blocked";

    case "run.failed":
      return "Run failed";

    case "run.cancelled":
      return "Run cancelled";

    default:
      return event.type;
  }
}

/**
 * Maps a persisted event type to the existing semantic badge palette.
 */
export function eventBadgeVariant(
  event: DomainEvent,
): EventBadgeVariant {
  if (
    event.type.includes(
      "failed",
    )
  ) {
    return "error";
  }

  if (
    event.type.includes(
      "blocked",
    )
  ) {
    return "warning";
  }

  if (
    event.type.includes(
      "completed",
    )
  ) {
    return "success";
  }

  if (
    event.type.includes(
      "cancelled",
    )
  ) {
    return "neutral";
  }

  return "running";
}

/**
 * Produces a short visual identifier while preserving the full identifier elsewhere.
 */
export function shortIdentifier(
  value: string,
): string {
  return value.slice(
    0,
    8,
  );
}

/**
 * Formats one event timestamp relative to a caller-provided clock.
 */
export function formatEventAge(
  createdAt: string,
  now: number,
): string {
  const timestamp =
    Date.parse(
      createdAt,
    );

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    return "Unknown";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (
          now -
          timestamp
        ) /
          1000,
      ),
    );

  if (
    seconds <
    60
  ) {
    return `${seconds}s ago`;
  }

  const minutes =
    Math.floor(
      seconds /
        60,
    );

  if (
    minutes <
    60
  ) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.floor(
      minutes /
        60,
    );

  if (
    hours <
    24
  ) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Formats one persisted timestamp into deterministic UTC text.
 */
export function formatEventTimestampUtc(
  value: string,
): string {
  const parsed =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return "Unknown";
  }

  return `${parsed
    .toISOString()
    .replace(
      "T",
      " ",
    )
    .slice(
      0,
      19,
    )} UTC`;
}
