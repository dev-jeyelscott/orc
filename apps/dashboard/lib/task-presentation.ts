import {
  formatDistanceToNow,
} from "date-fns";
import type {
  AgentExecution,
  Run,
  Task,
} from "@orc/shared";

export type StatusBadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

type LifecycleStatus =
  | Task["status"]
  | Run["status"]
  | AgentExecution["status"];

export type TokenUsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  availableExecutions: number;
};

export type ContextUsageSummary = {
  used: number | null;
  limit: number | null;
  percent: number | null;
};

const compactNumberFormatter =
  new Intl.NumberFormat(
    undefined,
    {
      notation: "compact",
      maximumFractionDigits: 1,
    },
  );

const absoluteDateFormatter =
  new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "medium",
    },
  );

/** Maps persisted lifecycle statuses onto the shared semantic Badge variants. */
export function getLifecycleBadgeVariant(
  status: LifecycleStatus,
): StatusBadgeVariant {
  switch (status) {
    case "running":
      return "running";

    case "completed":
      return "success";

    case "starting":
    case "blocked":
      return "warning";

    case "failed":
      return "error";

    case "pending":
    case "cancelled":
    default:
      return "neutral";
  }
}

/** Maps structured execution result statuses onto the shared semantic Badge variants. */
export function getResultBadgeVariant(
  status: AgentExecution["resultStatus"],
): StatusBadgeVariant {
  switch (status) {
    case "completed":
    case "approved":
      return "success";

    case "changes_requested":
    case "blocked":
      return "warning";

    case "failed":
      return "error";

    case null:
    default:
      return "neutral";
  }
}

/** Converts enum-like status values into compact human-readable labels. */
export function formatStatusLabel(
  value: string,
): string {
  return value
    .split("_")
    .filter(Boolean)
    .map(
      (part) =>
        `${part
          .charAt(0)
          .toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

/** Produces a stable short identifier for dense dashboard display. */
export function shortId(
  value: string | null | undefined,
  length = 8,
): string {
  if (!value) {
    return "-";
  }

  return value.slice(0, length);
}

/** Derives a repository-style display name from an absolute or compact path. */
export function projectNameFromPath(
  value: string,
): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/\/$/, "");

  const parts = normalized
    .split("/")
    .filter(Boolean);

  return parts.at(-1) ?? value;
}

/** Compacts common home-directory prefixes while preserving the authoritative path elsewhere. */
export function compactPath(
  value: string,
): string {
  const normalized =
    value.replace(/\\/g, "/");

  if (normalized === "/root") {
    return "~";
  }

  if (
    normalized.startsWith("/root/")
  ) {
    return `~${normalized.slice(
      "/root".length,
    )}`;
  }

  const homeMatch =
    normalized.match(
      /^\/(?:home|Users)\/[^/]+(\/.*)?$/,
    );

  if (homeMatch) {
    return `~${homeMatch[1] ?? ""}`;
  }

  return value;
}

/** Formats an ISO timestamp relative to the browser clock without fabricating missing values. */
export function formatRelativeTimestamp(
  value: string | null | undefined,
): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(parsed.getTime())
  ) {
    return "-";
  }

  return formatDistanceToNow(
    parsed,
    {
      addSuffix: true,
    },
  );
}

/** Formats an ISO timestamp using the browser locale for task and run metadata. */
export function formatAbsoluteTimestamp(
  value: string | null | undefined,
): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(parsed.getTime())
  ) {
    return "-";
  }

  return absoluteDateFormatter.format(
    parsed,
  );
}

/** Formats an exact token-like count compactly while retaining the underlying numeric value. */
export function formatTokenCount(
  value: number | null,
): string {
  return value === null
    ? "Unavailable"
    : compactNumberFormatter.format(
        value,
      );
}

/** Reads one finite non-negative numeric telemetry field without coercing untrusted provider data. */
function readNumericValue(
  record: Record<
    string,
    unknown
  >,
  key: string,
): number | null {
  const value = record[key];

  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

/** Returns the first supported numeric telemetry value from a list of provider field aliases. */
function readFirstNumericValue(
  record: Record<
    string,
    unknown
  >,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value =
      readNumericValue(
        record,
        key,
      );

    if (value !== null) {
      return value;
    }
  }

  return null;
}

/** Extracts exact token counters from one persisted provider usage object when recognized. */
function summarizeSingleTokenUsage(
  usage:
    | Record<string, unknown>
    | null,
): Omit<
  TokenUsageSummary,
  "availableExecutions"
> {
  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      totalTokens: null,
    };
  }

  const inputTokens =
    readFirstNumericValue(
      usage,
      [
        "input_tokens",
        "inputTokens",
        "prompt_tokens",
        "promptTokens",
      ],
    );

  const outputTokens =
    readFirstNumericValue(
      usage,
      [
        "output_tokens",
        "outputTokens",
        "completion_tokens",
        "completionTokens",
      ],
    );

  const cachedTokens =
    readFirstNumericValue(
      usage,
      [
        "cached_input_tokens",
        "cachedInputTokens",
        "cache_read_input_tokens",
        "cacheReadInputTokens",
      ],
    );

  const reportedTotal =
    readFirstNumericValue(
      usage,
      [
        "total_tokens",
        "totalTokens",
      ],
    );

  const totalTokens =
    reportedTotal ??
    (inputTokens !== null &&
    outputTokens !== null
      ? inputTokens +
        outputTokens
      : null);

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
  };
}

/** Aggregates only recognized exact token counters across persisted execution usage records. */
export function summarizeTokenUsage(
  executions:
    AgentExecution[],
): TokenUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;

  let hasInput = false;
  let hasOutput = false;
  let hasCached = false;
  let hasTotal = false;

  let availableExecutions = 0;

  for (
    const execution
    of executions
  ) {
    const summary =
      summarizeSingleTokenUsage(
        execution.tokenUsage,
      );

    const hasAnyValue =
      Object.values(
        summary,
      ).some(
        (value) =>
          value !== null,
      );

    if (!hasAnyValue) {
      continue;
    }

    availableExecutions += 1;

    if (
      summary.inputTokens !==
      null
    ) {
      inputTokens +=
        summary.inputTokens;
      hasInput = true;
    }

    if (
      summary.outputTokens !==
      null
    ) {
      outputTokens +=
        summary.outputTokens;
      hasOutput = true;
    }

    if (
      summary.cachedTokens !==
      null
    ) {
      cachedTokens +=
        summary.cachedTokens;
      hasCached = true;
    }

    if (
      summary.totalTokens !==
      null
    ) {
      totalTokens +=
        summary.totalTokens;
      hasTotal = true;
    }
  }

  return {
    inputTokens:
      hasInput
        ? inputTokens
        : null,
    outputTokens:
      hasOutput
        ? outputTokens
        : null,
    cachedTokens:
      hasCached
        ? cachedTokens
        : null,
    totalTokens:
      hasTotal
        ? totalTokens
        : null,
    availableExecutions,
  };
}

/** Extracts context usage only when persisted telemetry contains recognized numeric fields. */
export function summarizeContextUsage(
  usage:
    | Record<string, unknown>
    | null,
): ContextUsageSummary {
  if (!usage) {
    return {
      used: null,
      limit: null,
      percent: null,
    };
  }

  const used =
    readFirstNumericValue(
      usage,
      [
        "used",
        "used_tokens",
        "usedTokens",
        "current",
      ],
    );

  const limit =
    readFirstNumericValue(
      usage,
      [
        "limit",
        "limit_tokens",
        "limitTokens",
        "max",
      ],
    );

  const reportedPercent =
    readFirstNumericValue(
      usage,
      [
        "percent",
        "percentage",
        "usage_percent",
        "usagePercent",
      ],
    );

  const derivedPercent =
    reportedPercent ??
    (used !== null &&
    limit !== null &&
    limit > 0
      ? (used / limit) * 100
      : null);

  return {
    used,
    limit,
    percent:
      derivedPercent === null
        ? null
        : Math.min(
            100,
            Math.max(
              0,
              derivedPercent,
            ),
          ),
  };
}

/** Converts one event-data value into a short, safe text fragment for the activity stream. */
function formatEventValue(
  value: unknown,
): string | null {
  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    const text =
      String(value);

    return text.length > 72
      ? `${text.slice(
          0,
          69,
        )}...`
      : text;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  try {
    const serialized =
      JSON.stringify(value);

    if (!serialized) {
      return null;
    }

    return serialized.length >
      72
      ? `${serialized.slice(
          0,
          69,
        )}...`
      : serialized;
  } catch {
    return null;
  }
}

/** Produces a concise event-data description without dumping full persisted JSON into the UI. */
export function describeEventData(
  data: Record<
    string,
    unknown
  >,
): string {
  const preferredKeys = [
    "title",
    "status",
    "outcome",
    "reason",
    "agentId",
    "targetAgentId",
    "layer",
    "executionOrder",
    "harness",
    "model",
    "reasoning",
  ];

  const preferredParts =
    preferredKeys.flatMap(
      (key) => {
        if (!(key in data)) {
          return [];
        }

        const value =
          formatEventValue(
            data[key],
          );

        return value === null
          ? []
          : [
              `${key}: ${value}`,
            ];
      },
    );

  if (
    preferredParts.length > 0
  ) {
    return preferredParts
      .slice(0, 3)
      .join(" · ");
  }

  const fallbackParts =
    Object.entries(
      data,
    ).flatMap(
      ([key, value]) => {
        const formatted =
          formatEventValue(
            value,
          );

        return formatted === null
          ? []
          : [
              `${key}: ${formatted}`,
            ];
      },
    );

  return fallbackParts.length >
    0
    ? fallbackParts
        .slice(0, 3)
        .join(" · ")
    : "No additional data";
}
