"use client";

import Link from "next/link";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CopyIcon,
  PanelRightOpenIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import type {
  RunMonitoringDetail,
} from "@orc/shared";

import { ContextUsage } from "@/components/context-usage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  aggregateRunUsage,
  describeDomainEvent,
  findLatestFailure,
  formatCompactNumber,
  formatDateTime,
  formatRelativeTime,
  formatStatusLabel,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

interface RunInspectorDrawerProps {
  detail: RunMonitoringDetail;
}

interface DetailTabProps {
  detail: RunMonitoringDetail;
}

interface FactRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Copies one run identifier without allowing clipboard failure to interrupt monitoring.
 */
async function copyText(
  value: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      value,
    );
  } catch {
    // Clipboard access is optional and must not disrupt run inspection.
  }
}

/**
 * Resolves the semantic indicator used by one persisted business-domain event.
 */
function eventToneClass(
  type: string,
): string {
  if (
    type.includes(
      "failed",
    )
  ) {
    return "bg-status-error";
  }

  if (
    type.includes(
      "blocked",
    )
  ) {
    return "bg-status-warning";
  }

  if (
    type.includes(
      "completed",
    ) ||
    type ===
      "result.received"
  ) {
    return "bg-status-success";
  }

  if (
    type.includes(
      "cancelled",
    )
  ) {
    return "bg-status-neutral";
  }

  return "bg-status-running";
}

/**
 * Opens secondary authoritative run observability in an on-demand right-side inspector.
 */
export function RunInspectorDrawer({
  detail,
}: RunInspectorDrawerProps) {
  return (
    <Drawer swipeDirection="right">
      <DrawerTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
          />
        }
      >
        <PanelRightOpenIcon className="size-3.5" />
        Inspect
      </DrawerTrigger>

      <DrawerContent className="[--drawer-content-width:min(92vw,48rem)] sm:[--drawer-content-width:min(82vw,48rem)]">
        <DrawerHeader className="border-b border-divider p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle>
                Run Inspector
              </DrawerTitle>

              <DrawerDescription className="mt-1">
                Inspect persisted identity, usage, events, and failure state.
              </DrawerDescription>
            </div>

            <DrawerClose
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Close run inspector"
                />
              }
            >
              <XIcon className="size-4" />
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <Tabs
            defaultValue="facts"
            className="min-h-0"
          >
            <TabsList className="w-full">
              <TabsTrigger value="facts">
                Facts
              </TabsTrigger>

              <TabsTrigger value="usage">
                Usage
              </TabsTrigger>

              <TabsTrigger value="events">
                Events
              </TabsTrigger>

              <TabsTrigger value="failure">
                Failure
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="facts"
              className="mt-3"
            >
              <FactsTab
                detail={detail}
              />
            </TabsContent>

            <TabsContent
              value="usage"
              className="mt-3"
            >
              <UsageTab
                detail={detail}
              />
            </TabsContent>

            <TabsContent
              value="events"
              className="mt-3"
            >
              <EventsTab
                detail={detail}
              />
            </TabsContent>

            <TabsContent
              value="failure"
              className="mt-3"
            >
              <FailureTab
                detail={detail}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DrawerFooter className="border-t border-divider p-4">
          <Button
            variant="outline"
            render={
              <Link
                href={`/runs/${detail.run.id}`}
              />
            }
          >
            Open full run details
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Renders immutable identity and lifecycle facts for the selected run.
 */
function FactsTab({
  detail,
}: DetailTabProps) {
  const currentAgent =
    detail.executionPlan.find(
      (agent) =>
        agent.id ===
        detail.run.currentAgentId,
    ) ?? null;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          Run Facts
        </CardTitle>

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy run ID"
          onClick={() =>
            void copyText(
              detail.run.id,
            )
          }
        >
          <CopyIcon className="size-3" />
        </Button>
      </CardHeader>

      <CardContent className="grid gap-3 text-xs">
        <FactRow
          label="Run ID"
          value={detail.run.id}
          mono
        />

        <FactRow
          label="Task ID"
          value={
            detail.run.taskId ??
            "Unavailable"
          }
          mono
        />

        <FactRow
          label="Project"
          value={
            detail.run.projectPath
          }
        />

        <FactRow
          label="Status"
          value={formatStatusLabel(
            detail.run.status,
          )}
        />

        <FactRow
          label="Current Agent"
          value={
            currentAgent
              ? `${currentAgent.name} (${currentAgent.role})`
              : "Unavailable"
          }
        />

        <FactRow
          label="Created At"
          value={formatDateTime(
            detail.run.createdAt,
          )}
        />

        <FactRow
          label="Updated At"
          value={formatDateTime(
            detail.run.updatedAt,
          )}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Renders one wrapping inspector fact without allowing long identifiers to expand the drawer.
 */
function FactRow({
  label,
  value,
  mono = false,
}: FactRowProps) {
  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3">
      <span className="text-text-muted">
        {label}
      </span>

      <span
        className={cn(
          "break-all text-text-secondary",
          mono &&
            "font-mono text-[10px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Renders normalized persisted token and context telemetry with explicit partial and unavailable states.
 */
function UsageTab({
  detail,
}: DetailTabProps) {
  const usage =
    aggregateRunUsage(
      detail.executions,
    );

  return (
    <div className="flex flex-col gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            Token Usage
          </CardTitle>
        </CardHeader>

        <CardContent>
          {usage.tokens ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border-default bg-surface-interactive/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    Total
                  </p>

                  <p className="mt-1 font-medium tabular-nums text-text-primary">
                    {formatCompactNumber(
                      usage.tokens
                        .totalTokens,
                    )}
                  </p>
                </div>

                <div className="rounded-lg border border-border-default bg-surface-interactive/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    Input
                  </p>

                  <p className="mt-1 font-medium tabular-nums text-text-primary">
                    {formatCompactNumber(
                      usage.tokens
                        .inputTokens,
                    )}
                  </p>
                </div>

                <div className="rounded-lg border border-border-default bg-surface-interactive/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    Output
                  </p>

                  <p className="mt-1 font-medium tabular-nums text-text-primary">
                    {formatCompactNumber(
                      usage.tokens
                        .outputTokens,
                    )}
                  </p>
                </div>

                <div className="rounded-lg border border-border-default bg-surface-interactive/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">
                    Cached
                  </p>

                  <p className="mt-1 font-medium tabular-nums text-text-primary">
                    {formatCompactNumber(
                      usage.tokens
                        .cachedTokens,
                    )}
                  </p>
                </div>
              </div>

              {usage.tokenTelemetryPartial ? (
                <p className="mt-3 text-[10px] text-status-warning">
                  Token telemetry is available for only part of this run.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-text-muted">
              Provider token telemetry is unavailable.
            </p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>
            Context Usage
          </CardTitle>
        </CardHeader>

        <CardContent>
          {usage.context ? (
            usage.context
                .usedTokens !==
                null &&
            usage.context
                .limitTokens !==
                null ? (
              <ContextUsage
                label="Context Used"
                percent={
                  usage.context
                    .percent
                }
                current={formatCompactNumber(
                  usage.context
                    .usedTokens,
                )}
                total={formatCompactNumber(
                  usage.context
                    .limitTokens,
                )}
              />
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-secondary">
                    Context Used
                  </span>

                  <span className="font-medium tabular-nums text-text-primary">
                    {usage.context.percent.toFixed(
                      0,
                    )}
                    %
                  </span>
                </div>

                <Progress
                  value={
                    usage.context
                      .percent
                  }
                  className="[&_[data-slot=progress-indicator]]:bg-status-running"
                />
              </div>
            )
          ) : (
            <p className="text-xs text-text-muted">
              Context telemetry is unavailable.
            </p>
          )}

          {usage.contextTelemetryPartial ? (
            <p className="mt-3 text-[10px] text-status-warning">
              Context telemetry is available for only part of this run.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Renders recent persisted business-domain events independently from terminal output.
 */
function EventsTab({
  detail,
}: DetailTabProps) {
  const events =
    [...detail.events]
      .reverse()
      .slice(0, 12);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          Recent Events
        </CardTitle>
      </CardHeader>

      <CardContent>
        {events.length ? (
          <div className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[3px] before:top-2 before:w-px before:bg-divider">
            {events.map(
              (event) => (
                <div
                  key={event.id}
                  className="relative grid grid-cols-[8px_minmax(0,1fr)] gap-2.5"
                >
                  <span
                    className={cn(
                      "relative z-10 mt-1 size-2 rounded-full",
                      eventToneClass(
                        event.type,
                      ),
                    )}
                    aria-hidden="true"
                  />

                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-mono text-[10px] font-medium text-text-secondary">
                        {event.type}
                      </span>

                      <span className="shrink-0 text-[10px] text-text-muted">
                        {formatRelativeTime(
                          event.createdAt,
                        )}
                      </span>
                    </div>

                    <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
                      {describeDomainEvent(
                        event,
                        detail.executionPlan,
                        detail.executions,
                      )}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            No workflow events recorded.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Renders the latest persisted terminal or execution failure without inventing missing state.
 */
function FailureTab({
  detail,
}: DetailTabProps) {
  const failure =
    findLatestFailure(
      detail,
    );

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center gap-2">
        {failure ? (
          <XCircleIcon className="size-4 text-status-error" />
        ) : detail.run.status ===
          "completed" ? (
          <CheckCircle2Icon className="size-4 text-status-success" />
        ) : detail.run.status ===
          "cancelled" ? (
          <BanIcon className="size-4 text-status-neutral" />
        ) : (
          <CircleDotIcon className="size-4 text-status-running" />
        )}

        <CardTitle>
          Latest Failure / Terminal Reason
        </CardTitle>
      </CardHeader>

      <CardContent>
        {failure ? (
          <p className="text-xs leading-5 text-text-secondary">
            {failure}
          </p>
        ) : detail.run.status ===
          "completed" ? (
          <p className="text-xs text-status-success">
            Run completed without a recorded failure.
          </p>
        ) : detail.run.status ===
          "cancelled" ? (
          <p className="text-xs text-text-muted">
            Run was cancelled without an additional failure reason.
          </p>
        ) : (
          <>
            <p className="text-xs font-medium text-text-primary">
              No failure yet
            </p>

            <p className="mt-1 text-[11px] text-text-muted">
              Run has no persisted terminal failure reason.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
