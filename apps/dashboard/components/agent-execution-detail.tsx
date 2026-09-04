"use client";

import Link from "next/link";
import {
  useRouter,
} from "next/navigation";
import type {
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CopyIcon,
  FileCode2Icon,
  ListChecksIcon,
  RotateCcwIcon,
  TerminalSquareIcon,
  WaypointsIcon,
} from "lucide-react";

import type {
  AgentExecution,
  AgentExecutionMetrics,
  AgentResult,
  DomainEvent,
  RunMonitoringDetail,
} from "@orc/shared";

import {
  AgentExecutionTerminal,
} from "@/components/agent-execution-terminal";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Button,
} from "@/components/ui/button";
import {
  Progress,
} from "@/components/ui/progress";
import {
  Spinner,
} from "@/components/ui/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getAgentExecution,
  getAgentExecutionMetrics,
} from "@/lib/agent-executions";
import {
  formatBytes,
} from "@/lib/agent-presentation";
import {
  executionPlanPosition,
  getExecutionHandoffEvents,
  isExecutionRetryable,
} from "@/lib/agent-execution-detail-state";
import {
  describeDomainEvent,
  executionDurationMs,
  formatDateTime,
  formatDuration,
  formatStatusLabel,
  normalizeContextUsage,
  normalizeTokenUsage,
  projectNameFromPath,
  shortIdentifier,
} from "@/lib/run-observability";
import {
  getRunMonitoringDetail,
  retryRun,
} from "@/lib/workflows";
import {
  cn,
} from "@/lib/utils";

const POLL_INTERVAL_MS =
  2_000;

const ACTIVE_EXECUTION_STATUSES =
  new Set<
    AgentExecution["status"]
  >([
    "pending",
    "starting",
    "running",
  ]);

type SemanticBadgeVariant =
  | "running"
  | "success"
  | "warning"
  | "error"
  | "neutral";

interface MetricFactProps {
  label: string;
  value:
    ReactNode;
  detail?:
    ReactNode;
  valueClassName?:
    string;
}

interface HeaderFactProps {
  label: string;
  value:
    ReactNode;
  title?: string;
  mono?: boolean;
}

interface DefinitionRowProps {
  label: string;
  value:
    ReactNode;
  mono?: boolean;
  title?: string;
}

interface ResultSummaryCellProps {
  icon:
    ReactNode;
  label: string;
  primary: string;
  secondary: string;
}

interface ArrayPanelProps {
  title: string;
  items:
    string[];
  emptyLabel: string;
  mono?: boolean;
}

interface MetricsState {
  executionId:
    string;
  metrics:
    AgentExecutionMetrics | null;
}

/**
 * Converts execution lifecycle state into the repository's semantic badge variants.
 */
function executionStatusVariant(
  status:
    AgentExecution["status"],
): SemanticBadgeVariant {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "success";
    case "starting":
      return "warning";
    case "failed":
    case "blocked":
      return "error";
    case "pending":
    case "cancelled":
    default:
      return "neutral";
  }
}

/**
 * Converts structured result state into the repository's semantic badge variants.
 */
function resultStatusVariant(
  status:
    AgentResult["status"],
): SemanticBadgeVariant {
  switch (status) {
    case "completed":
    case "approved":
      return "success";
    case "changes_requested":
      return "warning";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

/**
 * Returns whether the server may currently expose live CPU and memory samples.
 */
function supportsLiveMetrics(
  status:
    AgentExecution["status"],
): boolean {
  return (
    status ===
      "starting" ||
    status ===
      "running"
  );
}

/**
 * Formats an integer counter without compacting away useful execution-level precision.
 */
function formatInteger(
  value:
    number | null,
): string {
  if (
    value === null
  ) {
    return "Unavailable";
  }

  return new Intl.NumberFormat(
    undefined,
  ).format(
    value,
  );
}

/**
 * Formats a structured unknown value without inventing interpretation for provider or agent-defined fields.
 */
function formatUnknown(
  value:
    unknown,
): string {
  if (
    value === null ||
    value ===
      undefined
  ) {
    return "None";
  }

  if (
    typeof value ===
      "string"
  ) {
    return value;
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return String(
      value,
    );
  }

  return JSON.stringify(
    value,
  );
}

/**
 * Copies one persisted identifier without allowing optional browser clipboard support to affect page operation.
 */
async function copyText(
  value:
    string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      value,
    );
  } catch {
    // Clipboard support is optional and must not interrupt observability.
  }
}

/**
 * Renders one bounded cell in the execution metadata strip.
 */
function MetricFact({
  label,
  value,
  detail,
  valueClassName,
}: MetricFactProps) {
  return (
    <div className="flex min-h-[4.75rem] min-w-0 flex-col justify-center border-divider px-3 py-2.5 max-xl:border-b xl:border-r xl:last:border-r-0">
      <span className="text-[10px] font-medium text-text-muted">
        {label}
      </span>

      <div
        className={cn(
          "mt-1 min-w-0 truncate text-xs font-medium text-text-primary",
          valueClassName,
        )}
      >
        {value}
      </div>

      {detail ? (
        <div className="mt-1 min-w-0 text-[9px] leading-3 text-text-muted">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders one compact header fact with stable typography and truncation.
 */
function HeaderFact({
  label,
  value,
  title,
  mono = false,
}: HeaderFactProps) {
  return (
    <div className="min-w-0 border-divider px-3 py-2.5 max-xl:border-b xl:border-l">
      <p className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>

      <div
        title={
          title
        }
        className={cn(
          "mt-1 min-w-0 truncate text-[11px] font-medium text-text-secondary",
          mono &&
            "font-mono tabular-nums",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Renders one compact label/value definition inside the inspector panels.
 */
function DefinitionRow({
  label,
  value,
  mono = false,
  title,
}: DefinitionRowProps) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 py-1">
      <dt className="text-[10px] leading-5 text-text-muted">
        {label}
      </dt>

      <dd
        title={
          title
        }
        className={cn(
          "min-w-0 break-words text-[10px] leading-5 font-medium text-text-secondary",
          mono &&
            "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Renders one structured-result summary cell using only persisted result content.
 */
function ResultSummaryCell({
  icon,
  label,
  primary,
  secondary,
}: ResultSummaryCellProps) {
  return (
    <div className="min-w-0 border-divider px-3 py-3 max-sm:border-b sm:border-r sm:last:border-r-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-text-primary">
        <span className="text-text-muted">
          {icon}
        </span>

        {label}
      </div>

      <p className="mt-2 text-[10px] font-medium text-text-secondary">
        {primary}
      </p>

      <p
        title={
          secondary
        }
        className="mt-1 line-clamp-2 text-[9px] leading-4 text-text-muted"
      >
        {secondary}
      </p>
    </div>
  );
}

/**
 * Renders the human-readable structured result panel from the validated completion contract.
 */
function StructuredResultPanel({
  execution,
}: {
  execution:
    AgentExecution;
}) {
  const result =
    execution.resultPayload;

  if (!result) {
    return (
      <section className="flex h-full min-h-60 min-w-0 items-center justify-center rounded-lg border border-border-default bg-surface-card p-6 text-center shadow-xs">
        <div className="max-w-md">
          <CircleAlertIcon className="mx-auto size-5 text-text-muted" />

          <h3 className="mt-2 font-heading text-xs font-medium text-text-primary">
            Structured result unavailable
          </h3>

          <p className="mt-1 text-[10px] leading-4 text-text-muted">
            This execution has not produced a validated structured result.
            {execution.failureReason
              ? ` ${execution.failureReason}`
              : ""}
          </p>
        </div>
      </section>
    );
  }

  const findings =
    result.findings;

  const files =
    result.filesChanged;

  const commands =
    result.commandsRun;

  const validationEntries =
    Object.entries(
      result.validation,
    );

  const detailsEntries =
    Object.entries(
      result.details,
    );

  const commit =
    execution.commitHash ??
    result.commit;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-divider px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[9px] font-medium uppercase tracking-wide text-text-muted">
            Result Status
          </p>

          <div className="mt-1">
            <Badge
              variant={
                resultStatusVariant(
                  result.status,
                )
              }
              className="h-5 px-2 text-[10px]"
            >
              {formatStatusLabel(
                result.status,
              )}
            </Badge>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-divider px-3 py-3">
        <p className="text-[10px] font-medium text-text-primary">
          Summary
        </p>

        <p className="mt-1 text-[10px] leading-5 text-text-secondary">
          {result.summary}
        </p>
      </div>

      <div className="grid shrink-0 sm:grid-cols-2 xl:grid-cols-4">
        <ResultSummaryCell
          icon={
            <CircleAlertIcon className="size-3.5" />
          }
          label="Findings"
          primary={`${findings.length} reported`}
          secondary={
            findings[0] ??
            "No findings reported"
          }
        />

        <ResultSummaryCell
          icon={
            <FileCode2Icon className="size-3.5" />
          }
          label="Files Changed"
          primary={`${files.length} ${files.length === 1 ? "file" : "files"}`}
          secondary={
            files[0] ??
            "No files reported"
          }
        />

        <ResultSummaryCell
          icon={
            <TerminalSquareIcon className="size-3.5" />
          }
          label="Commands Run"
          primary={`${commands.length} ${commands.length === 1 ? "command" : "commands"}`}
          secondary={
            commands[0] ??
            "No commands reported"
          }
        />

        <ResultSummaryCell
          icon={
            <ListChecksIcon className="size-3.5" />
          }
          label="Validation"
          primary={`${validationEntries.length} ${validationEntries.length === 1 ? "entry" : "entries"}`}
          secondary={
            validationEntries[0]
              ? `${validationEntries[0][0]}: ${formatUnknown(
                  validationEntries[0][1],
                )}`
              : "No validation data reported"
          }
        />
      </div>

      {detailsEntries.length >
      0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-divider px-3 py-2.5">
          <p className="mb-1 text-[10px] font-medium text-text-primary">
            Details
          </p>

          <dl className="divide-y divide-divider/70">
            {detailsEntries.map(
              (
                [
                  key,
                  value,
                ],
              ) => (
                <DefinitionRow
                  key={
                    key
                  }
                  label={
                    formatStatusLabel(
                      key,
                    )
                  }
                  value={
                    formatUnknown(
                      value,
                    )
                  }
                />
              ),
            )}
          </dl>
        </div>
      ) : (
        <div className="min-h-3 flex-1" />
      )}

      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t border-divider px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <WaypointsIcon className="size-3.5 shrink-0 text-text-muted" />

          <div className="min-w-0">
            <p className="text-[9px] text-text-muted">
              Commit
            </p>

            <p
              title={
                commit ??
                undefined
              }
              className="truncate font-mono text-[10px] text-text-secondary"
            >
              {commit
                ? shortIdentifier(
                    commit,
                    10,
                  )
                : "None"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the equal-height execution metadata inspector from persisted and currently supported live telemetry.
 */
function ExecutionDetailsPanel({
  execution,
  metrics,
}: {
  execution:
    AgentExecution;
  metrics:
    AgentExecutionMetrics | null;
}) {
  const tokens =
    normalizeTokenUsage(
      execution.tokenUsage,
    );

  const context =
    normalizeContextUsage(
      execution.contextUsage,
    );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs">
      <div className="flex h-10 shrink-0 items-center border-b border-divider px-3">
        <h3 className="font-heading text-xs font-medium text-text-primary">
          Execution Details
        </h3>
      </div>

      <div className="grid min-h-0 flex-1 divide-y divide-divider lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <dl className="min-w-0 px-3 py-2.5">
          <DefinitionRow
            label="Agent Role"
            value={
              execution.agentRole
            }
          />

          <DefinitionRow
            label="Harness"
            value={
              formatStatusLabel(
                execution.harness,
              )
            }
          />

          <DefinitionRow
            label="Model"
            value={
              execution.model
            }
          />

          <DefinitionRow
            label="Reasoning"
            value={
              formatStatusLabel(
                execution.reasoning,
              )
            }
          />

          <DefinitionRow
            label="Layer"
            value={
              String(
                execution.layer,
              )
            }
            mono
          />

          <DefinitionRow
            label="Order"
            value={
              String(
                execution.executionOrder,
              )
            }
            mono
          />

          <DefinitionRow
            label="Started At"
            value={
              formatDateTime(
                execution.startedAt,
              )
            }
          />

          <DefinitionRow
            label="Completed At"
            value={
              formatDateTime(
                execution.completedAt,
              )
            }
          />
        </dl>

        <dl className="min-w-0 px-3 py-2.5">
          <DefinitionRow
            label="Exit Code"
            value={
              execution.exitCode !==
              null
                ? String(
                    execution.exitCode,
                  )
                : "Unavailable"
            }
            mono
          />

          <DefinitionRow
            label="Failure Reason"
            value={
              execution.failureReason ??
              "None"
            }
          />

          <DefinitionRow
            label="CPU"
            value={
              metrics?.cpuPercent !==
                null &&
              metrics?.cpuPercent !==
                undefined
                ? `${metrics.cpuPercent.toFixed(
                    1,
                  )}%`
                : "Unavailable"
            }
            mono
          />

          <DefinitionRow
            label="Memory"
            value={
              formatBytes(
                metrics?.memoryBytes ??
                  null,
              )
            }
            mono
          />

          <DefinitionRow
            label="Input Tokens"
            value={
              formatInteger(
                tokens?.inputTokens ??
                  null,
              )
            }
            mono
          />

          <DefinitionRow
            label="Output Tokens"
            value={
              formatInteger(
                tokens?.outputTokens ??
                  null,
              )
            }
            mono
          />

          <DefinitionRow
            label="Context Usage"
            value={
              context
                ? `${context.percent.toFixed(
                    1,
                  )}%`
                : "Unavailable"
            }
            mono
          />

          <DefinitionRow
            label="Repair Attempted"
            value={
              execution.repairAttempted
                ? "Yes"
                : "No"
            }
          />
        </dl>
      </div>
    </section>
  );
}

/**
 * Renders a compact persisted-data overview without duplicating the raw JSON contract.
 */
function OverviewTab({
  execution,
  metrics,
}: {
  execution:
    AgentExecution;
  metrics:
    AgentExecutionMetrics | null;
}) {
  const duration =
    formatDuration(
      executionDurationMs(
        execution,
      ),
    );

  return (
    <div className="grid min-w-0 items-stretch gap-3 min-[1180px]:grid-cols-2">
      <section className="h-full min-w-0 rounded-lg border border-border-default bg-surface-card shadow-xs">
        <div className="flex h-10 items-center border-b border-divider px-3">
          <h3 className="font-heading text-xs font-medium text-text-primary">
            Lifecycle
          </h3>
        </div>

        <dl className="px-3 py-2.5">
          <DefinitionRow
            label="Status"
            value={
              formatStatusLabel(
                execution.status,
              )
            }
          />

          <DefinitionRow
            label="Duration"
            value={
              duration
            }
            mono
          />

          <DefinitionRow
            label="PID"
            value={
              execution.pid !==
              null
                ? String(
                    execution.pid,
                  )
                : "Unavailable"
            }
            mono
          />

          <DefinitionRow
            label="Result"
            value={
              execution.resultStatus
                ? formatStatusLabel(
                    execution.resultStatus,
                  )
                : "Unavailable"
            }
          />

          <DefinitionRow
            label="Failure"
            value={
              execution.failureReason ??
              "None"
            }
          />
        </dl>
      </section>

      <ExecutionDetailsPanel
        execution={
          execution
        }
        metrics={
          metrics
        }
      />
    </div>
  );
}

/**
 * Renders one real result-array panel with bounded scrolling for large completion payloads.
 */
function ArrayPanel({
  title,
  items,
  emptyLabel,
  mono = false,
}: ArrayPanelProps) {
  return (
    <section className="flex min-h-56 min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-divider px-3">
        <h3 className="font-heading text-xs font-medium text-text-primary">
          {title}
        </h3>

        <Badge
          variant="neutral"
          className="h-5 px-2 text-[9px]"
        >
          {items.length}
        </Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {items.length >
        0 ? (
          <div className="divide-y divide-divider/70">
            {items.map(
              (
                item,
                index,
              ) => (
                <div
                  key={`${item}-${index}`}
                  className={cn(
                    "break-words py-2 text-[10px] leading-4 text-text-secondary",
                    mono &&
                      "font-mono",
                  )}
                >
                  {item}
                </div>
              ),
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-32 items-center justify-center text-center text-[10px] text-text-muted">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Renders the persisted file, command, and validation sections of the normalized result contract.
 */
function FilesCommandsTab({
  execution,
}: {
  execution:
    AgentExecution;
}) {
  const result =
    execution.resultPayload;

  if (!result) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-lg border border-border-default bg-surface-card p-6 text-[10px] text-text-muted">
        No structured files, commands, or validation data is available.
      </div>
    );
  }

  const validationEntries =
    Object.entries(
      result.validation,
    );

  return (
    <div className="grid min-w-0 items-stretch gap-3 min-[1180px]:grid-cols-2">
      <ArrayPanel
        title="Files Changed"
        items={
          result.filesChanged
        }
        emptyLabel="No changed files were reported."
        mono
      />

      <ArrayPanel
        title="Commands Run"
        items={
          result.commandsRun
        }
        emptyLabel="No commands were reported."
        mono
      />

      <section className="min-w-0 rounded-lg border border-border-default bg-surface-card shadow-xs min-[1180px]:col-span-2">
        <div className="flex h-10 items-center justify-between border-b border-divider px-3">
          <h3 className="font-heading text-xs font-medium text-text-primary">
            Validation
          </h3>

          <Badge
            variant="neutral"
            className="h-5 px-2 text-[9px]"
          >
            {validationEntries.length}
          </Badge>
        </div>

        {validationEntries.length >
        0 ? (
          <dl className="grid gap-x-6 px-3 py-2.5 md:grid-cols-2">
            {validationEntries.map(
              (
                [
                  key,
                  value,
                ],
              ) => (
                <DefinitionRow
                  key={
                    key
                  }
                  label={
                    formatStatusLabel(
                      key,
                    )
                  }
                  value={
                    formatUnknown(
                      value,
                    )
                  }
                />
              ),
            )}
          </dl>
        ) : (
          <div className="px-3 py-6 text-center text-[10px] text-text-muted">
            No validation data was reported.
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Renders execution-scoped persisted route and retry events as the Handoffs tab.
 */
function HandoffsTab({
  events,
  detail,
}: {
  events:
    DomainEvent[];
  detail:
    RunMonitoringDetail;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs">
      <div className="flex h-10 items-center justify-between border-b border-divider px-3">
        <h3 className="font-heading text-xs font-medium text-text-primary">
          Handoffs
        </h3>

        <Badge
          variant="neutral"
          className="h-5 px-2 text-[9px]"
        >
          {events.length}
        </Badge>
      </div>

      {events.length >
      0 ? (
        <div className="divide-y divide-divider">
          {events.map(
            (
              event,
            ) => (
              <div
                key={
                  event.id
                }
                className="grid min-w-0 gap-1 px-3 py-2.5 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-center md:gap-3"
              >
                <span className="font-mono text-[9px] text-text-muted">
                  {formatStatusLabel(
                    event.type,
                  )}
                </span>

                <span className="min-w-0 text-[10px] text-text-secondary">
                  {describeDomainEvent(
                    event,
                    detail.executionPlan,
                    detail.executions,
                  )}
                </span>

                <span className="text-[9px] text-text-muted">
                  {formatDateTime(
                    event.createdAt,
                  )}
                </span>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="px-3 py-8 text-center text-[10px] text-text-muted">
          No handoff or routing events were recorded for this execution.
        </div>
      )}
    </section>
  );
}

/**
 * Loads and renders the dense Agent Execution operator console using authoritative persisted and live runtime data.
 */
export function AgentExecutionDetail({
  executionId,
}: {
  executionId:
    string;
}) {
  const router =
    useRouter();

  const [
    execution,
    setExecution,
  ] =
    useState<AgentExecution | null>(
      null,
    );

  const [
    detail,
    setDetail,
  ] =
    useState<RunMonitoringDetail | null>(
      null,
    );

  const [
    metricsState,
    setMetricsState,
  ] =
    useState<MetricsState | null>(
      null,
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    actionError,
    setActionError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    retrying,
    setRetrying,
  ] =
    useState(false);

  const [
    rawOpen,
    setRawOpen,
  ] =
    useState(false);

  const loadAbortRef =
    useRef<AbortController | null>(
      null,
    );

  const metricsAbortRef =
    useRef<AbortController | null>(
      null,
    );

  /**
   * Loads the execution plus its run monitoring aggregate while cancelling an older page request.
   */
  const load =
    useCallback(
      async () => {
        loadAbortRef.current?.abort();

        const controller =
          new AbortController();

        loadAbortRef.current =
          controller;

        try {
          const currentExecution =
            await getAgentExecution(
              executionId,
              controller.signal,
            );

          const currentDetail =
            await getRunMonitoringDetail(
              currentExecution.runId,
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setExecution(
            currentExecution,
          );

          setDetail(
            currentDetail,
          );

          setError(
            null,
          );
        } catch (
          caught
        ) {
          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          setError(
            caught instanceof
              Error
              ? caught.message
              : "Unable to load agent execution",
          );
        }
      },
      [
        executionId,
      ],
    );

  useEffect(() => {
    let disposed =
      false;

    queueMicrotask(
      () => {
        if (
          !disposed
        ) {
          void load();
        }
      },
    );

    return () => {
      disposed =
        true;

      loadAbortRef.current?.abort();
    };
  }, [
    load,
  ]);

  useEffect(() => {
    if (
      !execution ||
      !ACTIVE_EXECUTION_STATUSES.has(
        execution.status,
      )
    ) {
      return;
    }

    /**
     * Refreshes persisted execution state only while active work is visible.
     */
    function tick(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void load();
      }
    }

    const timer =
      window.setInterval(
        tick,
        POLL_INTERVAL_MS,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    execution,
    load,
  ]);

  useEffect(() => {
    if (
      !execution ||
      !supportsLiveMetrics(
        execution.status,
      )
    ) {
      metricsAbortRef.current?.abort();
      return;
    }

    let disposed =
      false;

    /**
     * Loads one execution-scoped live process metric sample.
     */
    async function loadMetrics(): Promise<void> {
      if (
        !execution
      ) {
        return;
      }

      metricsAbortRef.current?.abort();

      const controller =
        new AbortController();

      metricsAbortRef.current =
        controller;

      try {
        const metrics =
          await getAgentExecutionMetrics(
            execution.id,
            controller.signal,
          );

        if (
          disposed ||
          controller.signal
            .aborted
        ) {
          return;
        }

        setMetricsState({
          executionId:
            execution.id,
          metrics,
        });
      } catch {
        if (
          disposed ||
          controller.signal
            .aborted
        ) {
          return;
        }

        setMetricsState({
          executionId:
            execution.id,
          metrics: null,
        });
      }
    }

    void loadMetrics();

    const timer =
      window.setInterval(
        () => {
          if (
            document.visibilityState ===
            "visible"
          ) {
            void loadMetrics();
          }
        },
        POLL_INTERVAL_MS,
      );

    return () => {
      disposed =
        true;

      window.clearInterval(
        timer,
      );

      metricsAbortRef.current?.abort();
    };
  }, [
    execution,
  ]);

  /**
   * Starts the backend-supported final-execution retry and moves the operator to the authoritative Run Detail page.
   */
  async function handleRetry(): Promise<void> {
    if (
      !execution ||
      !detail ||
      !isExecutionRetryable(
        detail,
        execution,
      )
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Retry the final execution for this failed or blocked run?",
      );

    if (!confirmed) {
      return;
    }

    setRetrying(
      true,
    );

    setActionError(
      null,
    );

    try {
      await retryRun(
        detail.run.id,
      );

      router.push(
        `/runs/${detail.run.id}`,
      );

      router.refresh();
    } catch (
      caught
    ) {
      setActionError(
        caught instanceof
          Error
          ? caught.message
          : "Unable to retry execution",
      );
    } finally {
      setRetrying(
        false,
      );
    }
  }

  if (
    !execution &&
    error
  ) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-status-error/40 bg-status-error/5 px-4 py-10 text-center text-sm text-status-error"
      >
        {error}
      </div>
    );
  }

  if (
    !execution ||
    !detail
  ) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-border-default bg-surface-card">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Spinner className="size-4" />
          Loading agent execution...
        </div>
      </div>
    );
  }

  const metrics =
    metricsState
      ?.executionId ===
      execution.id
      ? metricsState.metrics
      : null;

  const tokens =
    normalizeTokenUsage(
      execution.tokenUsage,
    );

  const context =
    normalizeContextUsage(
      execution.contextUsage,
    );

  const duration =
    formatDuration(
      executionDurationMs(
        execution,
      ),
    );

  const projectName =
    projectNameFromPath(
      detail.run.projectPath,
    );

  const position =
    executionPlanPosition(
      detail,
      execution,
    );

  const retryable =
    isExecutionRetryable(
      detail,
      execution,
    );

  const handoffEvents =
    getExecutionHandoffEvents(
      detail,
      execution,
    );

  const result =
    execution.resultPayload;

  const inputTokens =
    tokens?.inputTokens ??
    null;

  const outputTokens =
    tokens?.outputTokens ??
    null;

  const contextDetail =
    context &&
    context.usedTokens !==
      null &&
    context.limitTokens !==
      null
      ? `${formatInteger(
          context.usedTokens,
        )} / ${formatInteger(
          context.limitTokens,
        )} tokens`
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex min-w-0 flex-col gap-2">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap overflow-hidden text-[10px]">
            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Link href="/projects" />
                }
              >
                Projects
              </BreadcrumbLink>
            </BreadcrumbItem>

            <BreadcrumbSeparator />

            <BreadcrumbItem className="min-w-0">
              <span
                title={
                  detail.run
                    .projectPath
                }
                className="max-w-32 truncate text-text-secondary"
              >
                {projectName}
              </span>
            </BreadcrumbItem>

            <BreadcrumbSeparator />

            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Link href="/runs" />
                }
              >
                Runs
              </BreadcrumbLink>
            </BreadcrumbItem>

            <BreadcrumbSeparator />

            <BreadcrumbItem>
              <BreadcrumbLink
                render={
                  <Link
                    href={`/runs/${detail.run.id}`}
                  />
                }
                className="font-mono"
              >
                {shortIdentifier(
                  detail.run.id,
                )}
              </BreadcrumbLink>
            </BreadcrumbItem>

            <BreadcrumbSeparator />

            <BreadcrumbItem className="hidden sm:flex">
              <span className="text-text-secondary">
                Agent Executions
              </span>
            </BreadcrumbItem>

            <BreadcrumbSeparator className="hidden sm:block" />

            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono text-[10px] font-medium text-text-primary">
                {shortIdentifier(
                  execution.id,
                )}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-status-running/30 bg-status-running/10 text-status-running">
                <BotIcon className="size-4" />
              </div>

              <h1 className="min-w-0 truncate font-heading text-lg font-semibold leading-8 text-text-primary">
                {execution.agentName}
              </h1>

              <Badge
                variant="outline"
                className="h-5 border-brand-accent/30 bg-brand-accent/10 px-2 text-[10px] text-brand-accent"
              >
                {execution.agentRole}
              </Badge>

              <Badge
                variant={
                  executionStatusVariant(
                    execution.status,
                  )
                }
                className="h-5 px-2 text-[10px]"
              >
                {formatStatusLabel(
                  execution.status,
                )}
              </Badge>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-border-default bg-surface-interactive/40 px-2 py-1 text-[9px] font-medium text-text-secondary">
                Layer{" "}
                {execution.layer}
                {position.maxLayer >
                execution.layer
                  ? ` of ${position.maxLayer}`
                  : ""}
              </span>

              <span className="rounded-md border border-border-default bg-surface-interactive/40 px-2 py-1 text-[9px] font-medium text-text-secondary">
                Order{" "}
                {execution.executionOrder}
              </span>

              {position.step !==
              null ? (
                <span className="rounded-md border border-border-default bg-surface-interactive/40 px-2 py-1 text-[9px] font-medium text-text-secondary">
                  Step{" "}
                  {position.step}
                  {" of "}
                  {position.total}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {retryable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  retrying
                }
                onClick={() =>
                  void handleRetry()
                }
              >
                <RotateCcwIcon />
                {retrying
                  ? "Retrying..."
                  : "Retry"}
              </Button>
            ) : null}

            <Button
              size="sm"
              render={
                <Link
                  href={`/runs/${execution.runId}`}
                />
              }
            >
              View Run
              <ArrowUpRightIcon />
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[0.8fr_0.8fr_0.8fr_1.7fr_1.35fr_1.35fr]">
          <HeaderFact
            label="Harness"
            value={
              formatStatusLabel(
                execution.harness,
              )
            }
          />

          <HeaderFact
            label="Model"
            value={
              execution.model
            }
          />

          <HeaderFact
            label="Reasoning"
            value={
              formatStatusLabel(
                execution.reasoning,
              )
            }
          />

          <HeaderFact
            label="Execution ID"
            title={
              execution.id
            }
            mono
            value={
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {execution.id}
                </span>

                <button
                  type="button"
                  title="Copy execution ID"
                  aria-label="Copy execution ID"
                  className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-interactive hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  onClick={() =>
                    void copyText(
                      execution.id,
                    )
                  }
                >
                  <CopyIcon className="size-3" />
                </button>
              </div>
            }
          />

          <HeaderFact
            label="Started"
            value={
              formatDateTime(
                execution.startedAt,
              )
            }
          />

          <HeaderFact
            label="Completed"
            value={
              formatDateTime(
                execution.completedAt,
              )
            }
          />
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex min-h-8 items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 text-[10px] text-status-warning"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" />
          Background refresh failed. The current persisted view remains visible.{" "}
          {error}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="flex min-h-8 items-center gap-2 rounded-md border border-status-error/40 bg-status-error/5 px-3 text-[10px] text-status-error"
        >
          <CircleAlertIcon className="size-3.5 shrink-0" />
          {actionError}
        </div>
      ) : null}

      <section
        aria-label="Execution metrics"
        className="grid min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8"
      >
        <MetricFact
          label="Status"
          value={
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  execution.status ===
                    "completed"
                    ? "bg-status-success"
                    : execution.status ===
                        "running"
                      ? "bg-status-running"
                      : execution.status ===
                            "failed" ||
                          execution.status ===
                            "blocked"
                        ? "bg-status-error"
                        : "bg-status-neutral",
                )}
              />

              {formatStatusLabel(
                execution.status,
              )}
            </span>
          }
        />

        <MetricFact
          label="Duration"
          value={
            duration
          }
          valueClassName="font-mono tabular-nums"
        />

        <MetricFact
          label="Exit Code"
          value={
            execution.exitCode !==
            null
              ? String(
                  execution.exitCode,
                )
              : "Unavailable"
          }
          valueClassName="font-mono tabular-nums"
        />

        <MetricFact
          label="PID"
          value={
            execution.pid !==
            null
              ? String(
                  execution.pid,
                )
              : "Unavailable"
          }
          valueClassName="font-mono tabular-nums"
        />

        <MetricFact
          label="Token Usage"
          value={
            tokens
              ? inputTokens !==
                    null ||
                  outputTokens !==
                    null
                ? `${formatInteger(
                    inputTokens,
                  )} / ${formatInteger(
                    outputTokens,
                  )}`
                : formatInteger(
                    tokens.totalTokens,
                  )
              : "Unavailable"
          }
          detail={
            tokens ? (
              inputTokens !==
                null ||
              outputTokens !==
                null
                ? "input / output"
                : "total tokens"
            ) : null
          }
          valueClassName="font-mono tabular-nums"
        />

        <MetricFact
          label="Context Usage"
          value={
            context
              ? `${context.percent.toFixed(
                  1,
                )}%`
              : "Unavailable"
          }
          detail={
            context ? (
              <div className="space-y-1">
                <Progress
                  value={
                    context.percent
                  }
                  aria-label="Execution context usage"
                  className="w-full gap-0 [&_[data-slot=progress-indicator]]:bg-status-running"
                />

                {contextDetail ? (
                  <span>
                    {contextDetail}
                  </span>
                ) : null}
              </div>
            ) : null
          }
          valueClassName="font-mono tabular-nums"
        />

        <MetricFact
          label="Repair Attempted"
          value={
            execution.repairAttempted
              ? "Yes"
              : "No"
          }
          valueClassName={
            execution.repairAttempted
              ? "text-status-warning"
              : undefined
          }
        />

        <MetricFact
          label="Commit"
          value={
            execution.commitHash
              ? shortIdentifier(
                  execution.commitHash,
                  10,
                )
              : "None"
          }
          detail={
            execution.commitHash
              ? execution.commitHash
              : null
          }
          valueClassName="font-mono"
        />
      </section>

      <AgentExecutionTerminal
        executionId={
          execution.id
        }
        title={`${execution.agentName} terminal`}
        heightClassName="h-[clamp(22rem,45vh,34rem)]"
        showControls
        subheader={
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[9px]">
            <span className="shrink-0 rounded border border-border-default bg-surface-interactive px-1.5 py-0.5 text-text-secondary">
              {formatStatusLabel(
                execution.harness,
              )}
            </span>

            <span
              title={
                execution.model
              }
              className="max-w-44 truncate rounded border border-border-default bg-surface-interactive px-1.5 py-0.5 text-text-secondary"
            >
              {execution.model}
            </span>

            <span className="shrink-0 rounded border border-border-default bg-surface-interactive px-1.5 py-0.5 font-mono text-text-secondary">
              PID{" "}
              {execution.pid ??
                "Unavailable"}
            </span>
          </div>
        }
      />

      <Tabs
        defaultValue="structured"
        className="min-w-0 gap-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
      >
        <div className="flex min-h-10 min-w-0 items-center justify-between gap-3 border-b border-divider px-3">
          <div className="min-w-0 overflow-x-auto">
            <TabsList
              variant="line"
              className="h-9 min-w-max gap-3 p-0"
            >
              <TabsTrigger
                value="overview"
                className="h-9 px-1.5 text-[10px]"
              >
                Overview
              </TabsTrigger>

              <TabsTrigger
                value="structured"
                className="h-9 px-1.5 text-[10px]"
              >
                Structured Result
              </TabsTrigger>

              <TabsTrigger
                value="files"
                className="h-9 px-1.5 text-[10px]"
              >
                Files / Commands
              </TabsTrigger>

              <TabsTrigger
                value="handoffs"
                className="h-9 px-1.5 text-[10px]"
              >
                Handoffs
              </TabsTrigger>
            </TabsList>
          </div>

          {result ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="shrink-0"
              onClick={() =>
                setRawOpen(
                  (
                    current,
                  ) =>
                    !current,
                )
              }
            >
              {rawOpen
                ? "Hide Raw JSON"
                : "View Raw JSON"}
            </Button>
          ) : null}
        </div>

        <TabsContent
          value="overview"
          className="m-0 p-3"
        >
          <OverviewTab
            execution={
              execution
            }
            metrics={
              metrics
            }
          />
        </TabsContent>

        <TabsContent
          value="structured"
          className="m-0 p-3"
        >
          {rawOpen &&
          result ? (
            <div className="mb-3 max-h-72 overflow-auto rounded-lg border border-border-default bg-bg-app p-3">
              <pre className="min-w-max font-mono text-[10px] leading-5 text-text-secondary">
                {JSON.stringify(
                  result,
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}

          <div className="grid min-w-0 items-stretch gap-3 min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
            <StructuredResultPanel
              execution={
                execution
              }
            />

            <ExecutionDetailsPanel
              execution={
                execution
              }
              metrics={
                metrics
              }
            />
          </div>
        </TabsContent>

        <TabsContent
          value="files"
          className="m-0 p-3"
        >
          <FilesCommandsTab
            execution={
              execution
            }
          />
        </TabsContent>

        <TabsContent
          value="handoffs"
          className="m-0 p-3"
        >
          <HandoffsTab
            events={
              handoffEvents
            }
            detail={
              detail
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
