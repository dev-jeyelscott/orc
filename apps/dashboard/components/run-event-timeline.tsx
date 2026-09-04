"use client";

import type {
  RunMonitoringDetail,
} from "@orc/shared";

import {
  describeDomainEvent,
  formatDateTime,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

interface RunEventTimelineProps {
  detail:
    RunMonitoringDetail;
  className?: string;
}

/**
 * Formats a persisted event timestamp as a compact local clock time.
 */
function formatEventTime(
  value: string,
): string {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour:
        "2-digit",
      minute:
        "2-digit",
      second:
        "2-digit",
    },
  ).format(date);
}

/**
 * Maps one persisted event type onto existing semantic status colors.
 */
function eventIndicatorClass(
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
 * Renders chronological persisted business events in one independently scrolling panel.
 */
export function RunEventTimeline({
  detail,
  className,
}: RunEventTimelineProps) {
  const events =
    detail.events;

  return (
    <section
      aria-labelledby="run-event-timeline-title"
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-xs",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-divider px-3">
        <h2
          id="run-event-timeline-title"
          className="font-heading text-xs font-medium text-text-primary"
        >
          Event
          Timeline
        </h2>

        <span className="text-[10px] tabular-nums text-text-muted">
          {
            events.length
          }{" "}
          {events.length ===
          1
            ? "event"
            : "events"}
        </span>
      </div>

      {events.length ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[500px] table-fixed border-collapse text-[10px]">
            <colgroup>
              <col className="w-[86px]" />
              <col className="w-[150px]" />
              <col />
            </colgroup>

            <thead className="sticky top-0 z-10 bg-surface-card">
              <tr className="h-8 border-b border-divider bg-surface-interactive/40 text-left text-text-muted">
                <th
                  scope="col"
                  className="px-2 font-medium"
                >
                  Time
                </th>

                <th
                  scope="col"
                  className="px-2 font-medium"
                >
                  Event
                </th>

                <th
                  scope="col"
                  className="px-2 font-medium"
                >
                  Details
                </th>
              </tr>
            </thead>

            <tbody>
              {events.map(
                (
                  event,
                  index,
                ) => {
                  const latest =
                    index ===
                    events.length -
                      1;

                  const description =
                    describeDomainEvent(
                      event,
                      detail.executionPlan,
                      detail.executions,
                    );

                  return (
                    <tr
                      key={
                        event.id
                      }
                      className={cn(
                        "h-8 border-b border-divider last:border-b-0",
                        latest &&
                          "bg-status-running/5",
                      )}
                    >
                      <td
                        title={formatDateTime(
                          event.createdAt,
                        )}
                        className="truncate px-2 font-mono tabular-nums text-text-muted"
                      >
                        <time
                          dateTime={
                            event.createdAt
                          }
                        >
                          {formatEventTime(
                            event.createdAt,
                          )}
                        </time>
                      </td>

                      <td
                        title={
                          event.type
                        }
                        className="px-2"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              eventIndicatorClass(
                                event.type,
                              ),
                            )}
                          />

                          <span className="truncate font-mono text-text-secondary">
                            {
                              event.type
                            }
                          </span>
                        </div>
                      </td>

                      <td
                        title={
                          description
                        }
                        className="truncate px-2 text-text-secondary"
                      >
                        {latest ? (
                          <span className="sr-only">
                            Latest
                            event.{" "}
                          </span>
                        ) : null}

                        {
                          description
                        }
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex min-h-32 flex-1 items-center justify-center px-4 text-center text-xs text-text-muted">
          No
          persisted
          domain
          events
          yet.
        </div>
      )}
    </section>
  );
}
