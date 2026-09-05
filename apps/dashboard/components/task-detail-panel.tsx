"use client";

import Link from "next/link";
import {
  BanIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlayIcon,
  RefreshCwIcon,
  TerminalSquareIcon,
} from "lucide-react";
import type {
  ReactNode,
} from "react";
import type {
  Project,
  Run,
  RunDetail,
  Task,
} from "@orc/shared";

import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  ScrollArea,
} from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  compactPath,
  describeEventData,
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  formatStatusLabel,
  getLifecycleBadgeVariant,
  projectNameFromPath,
  shortId,
} from "@/lib/task-presentation";

type TaskDetailPanelProps = {
  task: Task | null;
  project: Project | null;
  runs: Run[];
  latestRunDetail:
    RunDetail | null;
  runDetailLoading:
    boolean;
  runDetailError:
    string | null;
  busyRunId:
    string | null;
  onCancelRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onRetryRun:
    (
      runId: string,
    ) => Promise<void> | void;
};

const activeRunStatuses =
  new Set<Run["status"]>([
    "pending",
    "running",
  ]);

const retryableRunStatuses =
  new Set<Run["status"]>([
    "failed",
    "blocked",
  ]);

/** Copies compact operator metadata without making clipboard support a hard dependency. */
function copyText(
  value: string,
): void {
  if (
    typeof navigator !==
      "undefined" &&
    navigator.clipboard
  ) {
    void navigator.clipboard.writeText(
      value,
    );
  }
}

/** Renders the selected task overview, related run controls, and activity without leaving the page. */
export function TaskDetailPanel({
  task,
  project,
  runs,
  latestRunDetail,
  runDetailLoading,
  runDetailError,
  busyRunId,
  onCancelRun,
  onRetryRun,
}: TaskDetailPanelProps) {
  if (!task) {
    return (
      <section className="neon-surface flex min-h-[38rem] items-center justify-center rounded-lg border border-border-default bg-surface-elevated p-8 text-center shadow-xs">
        <div>
          <p className="text-sm font-medium text-text-secondary">
            No task selected
          </p>

          <p className="mt-1 text-xs text-text-muted">
            Select a task
            from the queue to
            inspect its
            instruction and
            workflow history.
          </p>
        </div>
      </section>
    );
  }

  const latestRun =
    runs[0] ?? null;

  const latestExecution =
    latestRunDetail
      ?.executions.at(-1) ??
    null;

  return (
    <section className="neon-surface min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs">
      <header className="border-b border-divider px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  task.status ===
                  "running"
                    ? "bg-status-running"
                    : "bg-status-neutral"
                }`}
                aria-hidden="true"
              />

              <h2 className="truncate font-heading text-lg font-semibold text-text-primary">
                {task.title}
              </h2>

              <Badge
                variant={getLifecycleBadgeVariant(
                  task.status,
                )}
              >
                {formatStatusLabel(
                  task.status,
                )}
              </Badge>
            </div>

            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
              <span>
                #
                {shortId(
                  task.id,
                )}
              </span>

              <span
                aria-hidden="true"
              >
                ·
              </span>

              <span>
                {projectNameFromPath(
                  task.projectPath,
                )}
              </span>

              <span
                aria-hidden="true"
              >
                ·
              </span>

              <span className="truncate">
                {compactPath(
                  task.projectPath,
                )}
              </span>
            </div>
          </div>

          <span className="shrink-0 text-xs text-text-muted">
            Updated{" "}
            {formatRelativeTimestamp(
              task.updatedAt,
            )}
          </span>
        </div>
      </header>

      <Tabs
        defaultValue="overview"
        className="gap-0"
      >
        <div className="border-b border-divider px-3">
          <TabsList
            variant="line"
            className="h-9"
          >
            <TabsTrigger value="overview">
              Overview
            </TabsTrigger>

            <TabsTrigger value="runs">
              Runs ({runs.length})
            </TabsTrigger>

            <TabsTrigger value="activity">
              Activity
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="p-4"
        >
          <div className="space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-text-secondary">
                  Instruction
                </h3>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    copyText(
                      task.instruction,
                    )
                  }
                  aria-label="Copy task instruction"
                >
                  <CopyIcon />
                </Button>
              </div>

              <div className="neon-surface max-h-52 overflow-auto rounded-lg border border-border-default bg-bg-app p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-text-secondary">
                {
                  task.instruction
                }
              </div>
            </section>

            <section className="neon-surface grid overflow-hidden rounded-lg border border-border-default md:grid-cols-2">
              <MetadataItem
                label="Task ID"
                value={task.id}
                mono
              />

              <MetadataItem
                label="Project Path"
                value={compactPath(
                  task.projectPath,
                )}
                mono
              />

              <MetadataItem
                label="Status"
                value={formatStatusLabel(
                  task.status,
                )}
              />

              <MetadataItem
                label="Branch"
                value={
                  project?.branch ??
                  "Unavailable"
                }
                icon={
                  <GitBranchIcon
                    className="size-3.5"
                    aria-hidden="true"
                  />
                }
                mono
              />

              <MetadataItem
                label="Created"
                value={formatAbsoluteTimestamp(
                  task.createdAt,
                )}
              />

              <MetadataItem
                label="Updated"
                value={formatAbsoluteTimestamp(
                  task.updatedAt,
                )}
              />

              <MetadataItem
                label="Git State"
                value={
                  project
                    ? formatStatusLabel(
                        project.gitState,
                      )
                    : "Unavailable"
                }
              />

              <MetadataItem
                label="Latest Run"
                value={
                  latestRun
                    ? shortId(
                        latestRun.id,
                      )
                    : "Not started"
                }
                mono
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-text-secondary">
                  Related Runs
                </h3>

                {runDetailLoading ? (
                  <span className="text-xs text-text-muted">
                    Refreshing
                    latest run...
                  </span>
                ) : null}
              </div>

              {runDetailError ? (
                <p className="mb-2 rounded-lg border border-status-error/30 bg-status-error/10 p-2 text-xs text-status-error">
                  {
                    runDetailError
                  }
                </p>
              ) : null}

              {runs.length > 0 ? (
                <div className="space-y-2">
                  {runs
                    .slice(0, 3)
                    .map(
                      (run) => (
                        <RelatedRunCard
                          key={
                            run.id
                          }
                          run={run}
                          latestRunDetail={
                            latestRunDetail
                          }
                          latestExecutionId={
                            latestExecution?.id ??
                            null
                          }
                          busy={
                            busyRunId ===
                            run.id
                          }
                          onCancelRun={
                            onCancelRun
                          }
                          onRetryRun={
                            onRetryRun
                          }
                        />
                      ),
                    )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border-default p-6 text-center text-sm text-text-muted">
                  No run is
                  associated with
                  this task yet.
                </p>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent
          value="runs"
          className="p-4"
        >
          {runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map(
                (run) => (
                  <RelatedRunCard
                    key={run.id}
                    run={run}
                    latestRunDetail={
                      latestRunDetail
                    }
                    latestExecutionId={
                      latestExecution?.id ??
                      null
                    }
                    busy={
                      busyRunId ===
                      run.id
                    }
                    onCancelRun={
                      onCancelRun
                    }
                    onRetryRun={
                      onRetryRun
                    }
                  />
                ),
              )}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">
              No related runs
              are available.
            </p>
          )}
        </TabsContent>

        <TabsContent
          value="activity"
          className="p-4"
        >
          {latestRunDetail
            ?.events.length ? (
            <ScrollArea className="h-[30rem]">
              <div className="space-y-2 pr-3">
                {latestRunDetail.events.map(
                  (event) => (
                    <div
                      key={
                        event.id
                      }
                      className="neon-surface rounded-lg border border-border-default bg-surface-card p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs font-medium text-link">
                          {
                            event.type
                          }
                        </span>

                        <span className="shrink-0 text-[11px] text-text-muted">
                          {formatRelativeTimestamp(
                            event.createdAt,
                          )}
                        </span>
                      </div>

                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {describeEventData(
                          event.data,
                        )}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </ScrollArea>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">
              {latestRun
                ? "No workflow events recorded for the latest run."
                : "Start the task to create workflow activity."}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

/** Renders one compact task metadata cell using the design-system divider treatment. */
function MetadataItem({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-divider px-3 py-2.5 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0">
      <span className="shrink-0 text-xs text-text-muted">
        {label}
      </span>

      <span
        className={`flex min-w-0 items-center gap-1.5 truncate text-right text-xs text-text-secondary ${
          mono
            ? "font-mono"
            : ""
        }`}
        title={value}
      >
        {icon}

        <span className="truncate">
          {value}
        </span>
      </span>
    </div>
  );
}

/** Renders one related run with only actions allowed by the current backend run state. */
function RelatedRunCard({
  run,
  latestRunDetail,
  latestExecutionId,
  busy,
  onCancelRun,
  onRetryRun,
}: {
  run: Run;
  latestRunDetail:
    RunDetail | null;
  latestExecutionId:
    string | null;
  busy: boolean;
  onCancelRun:
    (
      runId: string,
    ) => Promise<void> | void;
  onRetryRun:
    (
      runId: string,
    ) => Promise<void> | void;
}) {
  const detailMatches =
    latestRunDetail?.run.id ===
    run.id;

  return (
    <div className="neon-surface rounded-lg border border-border-default bg-surface-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PlayIcon
            className="size-3.5 shrink-0 text-status-running"
            aria-hidden="true"
          />

          <span className="font-mono text-xs text-text-primary">
            Run #
            {shortId(
              run.id,
            )}
          </span>

          <Badge
            variant={getLifecycleBadgeVariant(
              run.status,
            )}
          >
            {formatStatusLabel(
              run.status,
            )}
          </Badge>
        </div>

        <span className="text-[11px] text-text-muted">
          Updated{" "}
          {formatRelativeTimestamp(
            run.updatedAt,
          )}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <p className="text-text-muted">
          Executions{" "}
          <span className="ml-1 font-mono text-text-secondary">
            {
              run.executionCount
            }
          </span>
        </p>

        <p className="text-text-muted">
          Current agent{" "}
          <span className="ml-1 font-mono text-text-secondary">
            {shortId(
              run.currentAgentId,
            )}
          </span>
        </p>

        <p className="text-text-muted sm:col-span-2">
          Terminal reason{" "}
          <span className="ml-1 text-text-secondary">
            {run.terminalReason ??
              "-"}
          </span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="xs"
          render={
            <Link
              href={`/runs/${run.id}`}
            />
          }
        >
          <ExternalLinkIcon />
          Open Run
        </Button>

        {detailMatches &&
        latestExecutionId ? (
          <Button
            variant="outline"
            size="xs"
            render={
              <Link
                href={`/agent-executions/${latestExecutionId}`}
              />
            }
          >
            <TerminalSquareIcon />
            View Terminal
          </Button>
        ) : null}

        {retryableRunStatuses.has(
          run.status,
        ) ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              void onRetryRun(
                run.id,
              )
            }
            disabled={busy}
          >
            <RefreshCwIcon
              className={
                busy
                  ? "animate-spin motion-reduce:animate-none"
                  : undefined
              }
            />

            Retry
          </Button>
        ) : null}

        {activeRunStatuses.has(
          run.status,
        ) ? (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() =>
              void onCancelRun(
                run.id,
              )
            }
            disabled={busy}
          >
            <BanIcon />
            Cancel Run
          </Button>
        ) : null}
      </div>
    </div>
  );
}
