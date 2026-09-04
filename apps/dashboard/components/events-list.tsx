"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EVENT_LIST_DEFAULT_PAGE_SIZE,
  type DomainEvent,
  type EventListResponse,
} from "@orc/shared";
import {
  ActivityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  RefreshCcwIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  describeDomainEvent,
  eventBadgeVariant,
  formatEventTimestampUtc,
  shortIdentifier,
} from "@/lib/event-observability";
import { getEvents } from "@/lib/events";

/**
 * Converts an unknown request failure into concise operator-readable text.
 */
function errorMessage(
  error: unknown,
): string {
  return error instanceof
    Error
    ? error.message
    : "Unable to load system events";
}

/**
 * Determines whether one request failure represents an intentionally aborted browser fetch.
 */
function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof
      DOMException &&
    error.name ===
      "AbortError"
  );
}

/**
 * Renders lightweight placeholders during the first event-history request.
 */
function EventsLoadingState() {
  return (
    <div className="space-y-3 py-2">
      {Array.from({
        length: 6,
      }).map(
        (
          _value,
          index,
        ) => (
          <div
            key={
              index
            }
            className="grid grid-cols-[120px_180px_minmax(0,1fr)] gap-3"
          >
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
          </div>
        ),
      )}
    </div>
  );
}

/**
 * Renders the event type using the same semantic indicator as the Dashboard preview.
 */
function EventType({
  event,
}: {
  event:
    DomainEvent;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant={
          eventBadgeVariant(
            event,
          )
        }
        className="size-4 rounded-full p-0"
        aria-label={
          event.type
        }
      >
        <span
          aria-hidden="true"
          className="size-1 rounded-full bg-current"
        />
      </Badge>

      <span className="font-mono text-xs font-medium text-text-primary">
        {
          event.type
        }
      </span>
    </div>
  );
}

/**
 * Renders navigable Run and Execution references for one persisted event.
 */
function EventReferences({
  event,
}: {
  event:
    DomainEvent;
}) {
  if (
    !event.runId &&
    !event.agentExecutionId
  ) {
    return (
      <span className="text-text-muted">
        None
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {event.runId ? (
        <Link
          href={`/runs/${event.runId}`}
          title={
            event.runId
          }
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Run{" "}
          {
            shortIdentifier(
              event.runId,
            )
          }
        </Link>
      ) : null}

      {event.agentExecutionId ? (
        <Link
          href={`/agent-executions/${event.agentExecutionId}`}
          title={
            event.agentExecutionId
          }
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          Execution{" "}
          {
            shortIdentifier(
              event.agentExecutionId,
            )
          }
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Renders the paginated persisted domain-event history and refresh controls.
 */
export function EventsList() {
  const [
    data,
    setData,
  ] =
    useState<
      EventListResponse | null
    >(null);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(
      true,
    );

  const [
    isRefreshing,
    setIsRefreshing,
  ] =
    useState(
      false,
    );

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const abortRef =
    useRef<
      AbortController | null
    >(null);

  /**
   * Loads one event-history page while cancelling an older in-flight list request.
   */
  const loadPage =
    useCallback(
      async (
        page: number,
        refresh =
          false,
      ) => {
        abortRef.current?.abort();

        const controller =
          new AbortController();

        abortRef.current =
          controller;

        if (
          refresh
        ) {
          setIsRefreshing(
            true,
          );
          setIsLoading(
            false,
          );
        } else {
          setIsLoading(
            true,
          );
          setIsRefreshing(
            false,
          );
        }

        try {
          const next =
            await getEvents(
              page,
              EVENT_LIST_DEFAULT_PAGE_SIZE,
              controller.signal,
            );

          if (
            controller.signal.aborted
          ) {
            return;
          }

          setData(
            next,
          );

          setError(
            null,
          );
        } catch (
          requestError
        ) {
          if (
            !isAbortError(
              requestError,
            )
          ) {
            setError(
              errorMessage(
                requestError,
              ),
            );
          }
        } finally {
          if (
            abortRef.current ===
            controller
          ) {
            setIsLoading(
              false,
            );
            setIsRefreshing(
              false,
            );
          }
        }
      },
      [],
    );

  useEffect(
    () => {
      let disposed =
        false;

      queueMicrotask(
        () => {
          if (
            !disposed
          ) {
            void loadPage(
              1,
            );
          }
        },
      );

      return () => {
        disposed =
          true;

        abortRef.current?.abort();
      };
    },
    [
      loadPage,
    ],
  );

  /**
   * Loads a previous or next page without changing visible page state until the request succeeds.
   */
  function handlePageChange(
    page: number,
  ) {
    if (
      page <
      1
    ) {
      return;
    }

    void loadPage(
      page,
    );
  }

  const page =
    data?.page ??
    1;

  const canGoPrevious =
    Boolean(
      data &&
        page >
          1,
    );

  const canGoNext =
    Boolean(
      data?.hasMore,
    );

  const requestPending =
    isLoading ||
    isRefreshing;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Events
          </h1>

          <p className="mt-1 text-sm text-text-muted">
            Persisted workflow and orchestration activity
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={
            requestPending
          }
          onClick={() =>
            void loadPage(
              page,
              true,
            )
          }
        >
          <RefreshCcwIcon
            className={
              isRefreshing
                ? "animate-spin"
                : undefined
            }
          />
          Refresh
        </Button>
      </header>

      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <span>
            {error}
          </span>
        </div>
      ) : null}

      <Card
        className="min-w-0"
        aria-busy={
          requestPending
        }
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm">
              System Event History
            </CardTitle>

            {data ? (
              <p className="mt-1 text-xs text-text-muted">
                Page{" "}
                {
                  data.page
                }{" "}
                · up to{" "}
                {
                  data.pageSize
                }{" "}
                events
              </p>
            ) : null}
          </div>

          <ActivityIcon className="size-4 text-text-muted" />
        </CardHeader>

        <CardContent className="min-w-0">
          {isLoading &&
          !data ? (
            <EventsLoadingState />
          ) : !data ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-text-muted">
              Event history could not be loaded.
            </div>
          ) : data.events.length ===
            0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-text-muted">
              No domain events recorded yet.
            </div>
          ) : (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44 text-xs text-text-muted">
                    Timestamp
                  </TableHead>
                  <TableHead className="w-52 text-xs text-text-muted">
                    Type
                  </TableHead>
                  <TableHead className="text-xs text-text-muted">
                    Description
                  </TableHead>
                  <TableHead className="w-64 text-xs text-text-muted">
                    Project
                  </TableHead>
                  <TableHead className="w-64 text-xs text-text-muted">
                    References
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {data.events.map(
                  (
                    event,
                  ) => (
                    <TableRow
                      key={
                        event.id
                      }
                    >
                      <TableCell className="font-mono text-[11px] text-text-muted">
                        {
                          formatEventTimestampUtc(
                            event.createdAt,
                          )
                        }
                      </TableCell>

                      <TableCell>
                        <EventType
                          event={
                            event
                          }
                        />
                      </TableCell>

                      <TableCell className="whitespace-normal text-xs leading-5 text-text-secondary">
                        {
                          describeDomainEvent(
                            event,
                          )
                        }
                      </TableCell>

                      <TableCell className="max-w-64">
                        <span
                          title={
                            event.projectPath
                          }
                          className="block truncate font-mono text-[11px] text-text-secondary"
                        >
                          {
                            event.projectPath
                          }
                        </span>
                      </TableCell>

                      <TableCell className="text-xs">
                        <EventReferences
                          event={
                            event
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}

          {data ? (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-text-muted">
                Page{" "}
                {
                  data.page
                }
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    requestPending ||
                    !canGoPrevious
                  }
                  onClick={() =>
                    handlePageChange(
                      page -
                        1,
                    )
                  }
                >
                  <ChevronLeftIcon />
                  Previous
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    requestPending ||
                    !canGoNext
                  }
                  onClick={() =>
                    handlePageChange(
                      page +
                        1,
                    )
                  }
                >
                  Next
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
