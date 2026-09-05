"use client";

import {
  useRouter,
} from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  RunMonitoringDetail,
  RunMonitoringSummary,
} from "@orc/shared";

import {
  IdleRunTerminalDialog,
} from "@/components/idle-run-terminal-dialog";
import {
  IDLE_RUN_THRESHOLD_MS,
  isIdleRunEligible,
  nextIdleDialogRunId,
  selectActiveRun,
} from "@/lib/idle-run-monitor-state";
import {
  getRunMonitoringDetail,
  getRunMonitoringRuns,
} from "@/lib/workflows";

const MONITOR_POLL_INTERVAL_MS =
  2_000;

const DASHBOARD_ACTIVITY_EVENTS = [
  "pointermove",
  "mousemove",
  "pointerdown",
  "keydown",
  "touchstart",
  "touchmove",
  "scroll",
  "click",
] as const;

type DashboardActivityEvent =
  (typeof DASHBOARD_ACTIVITY_EVENTS)[number];

/**
 * Converts an unknown monitoring failure into a compact operator-readable message.
 */
function monitoringErrorMessage(
  error: unknown,
): string {
  return error instanceof
    Error
    ? error.message
    : "Unable to refresh run monitoring";
}

/**
 * Determines whether one monitoring request ended because a newer request replaced it.
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
 * Returns event-listener options appropriate for one dashboard activity event.
 */
function activityListenerOptions(
  eventName:
    DashboardActivityEvent,
): AddEventListenerOptions {
  return {
    capture:
      eventName ===
      "scroll",
    passive:
      eventName !==
      "keydown",
  };
}

/**
 * Monitors dashboard inactivity and authoritative active-run state across route navigation.
 */
export function IdleRunMonitor() {
  const router =
    useRouter();

  const [
    openRunId,
    setOpenRunId,
  ] =
    useState<
      string | null
    >(null);

  const [
    activeRun,
    setActiveRun,
  ] =
    useState<
      RunMonitoringSummary | null
    >(null);

  const [
    detail,
    setDetail,
  ] =
    useState<
      RunMonitoringDetail | null
    >(null);

  const [
    monitoringWarning,
    setMonitoringWarning,
  ] =
    useState<
      string | null
    >(null);

  const lastActivityAtRef =
    useRef<
      number | null
    >(null);

  const idleTimeoutRef =
    useRef<
      number | null
    >(null);

  const monitorAbortRef =
    useRef<
      AbortController | null
    >(null);

  const openRunIdRef =
    useRef<
      string | null
    >(null);

  const activeRunRef =
    useRef<
      RunMonitoringSummary | null
    >(null);

  const loadMonitoringRef =
    useRef<
      (() => Promise<void>) | null
    >(null);

  /**
   * Returns the current activity timestamp and initializes it outside render when necessary.
   */
  const ensureLastActivityAt =
    useCallback(
      (): number => {
        const current =
          lastActivityAtRef.current;

        if (
          current !==
          null
        ) {
          return current;
        }

        const now =
          Date.now();

        lastActivityAtRef.current =
          now;

        return now;
      },
      [],
    );

  /**
   * Updates dialog state and its synchronous ref together for async monitoring transitions.
   */
  const updateOpenRunId =
    useCallback(
      (
        runId:
          | string
          | null,
      ): void => {
        openRunIdRef.current =
          runId;

        setOpenRunId(
          runId,
        );
      },
      [],
    );

  /**
   * Maintains the single inactivity timeout against the latest activity timestamp.
   */
  const scheduleIdleCheck =
    useCallback(
      (): void => {
        if (
          idleTimeoutRef.current !==
          null
        ) {
          window.clearTimeout(
            idleTimeoutRef.current,
          );

          idleTimeoutRef.current =
            null;
        }

        const lastActivityAt =
          ensureLastActivityAt();

        const elapsed =
          Date.now() -
          lastActivityAt;

        const remaining =
          IDLE_RUN_THRESHOLD_MS -
          elapsed;

        if (
          remaining <=
          0
        ) {
          return;
        }

        /**
         * Refreshes authoritative monitoring exactly when the inactivity threshold is reached.
         */
        function handleIdleThreshold(): void {
          idleTimeoutRef.current =
            null;

          if (
            document.visibilityState !==
            "visible"
          ) {
            return;
          }

          void loadMonitoringRef.current?.();
        }

        idleTimeoutRef.current =
          window.setTimeout(
            handleIdleThreshold,
            remaining,
          );
      },
      [
        ensureLastActivityAt,
      ],
    );

  /**
   * Records dashboard interaction without triggering a React render.
   */
  const recordActivity =
    useCallback(
      (): void => {
        lastActivityAtRef.current =
          Date.now();

        scheduleIdleCheck();
      },
      [
        scheduleIdleCheck,
      ],
    );

  /**
   * Refreshes persisted run summaries and active-run detail with cancellation of older requests.
   */
  const loadMonitoring =
    useCallback(
      async (): Promise<void> => {
        monitorAbortRef.current?.abort();

        const controller =
          new AbortController();

        monitorAbortRef.current =
          controller;

        try {
          const runs =
            await getRunMonitoringRuns(
              controller.signal,
            );

          if (
            controller.signal
              .aborted
          ) {
            return;
          }

          const confirmedActiveRun =
            selectActiveRun(
              runs,
            );

          const idleEligible =
            isIdleRunEligible({
              now:
                Date.now(),
              lastActivityAt:
                ensureLastActivityAt(),
              visibilityState:
                document.visibilityState,
            });

          const nextOpenRunId =
            nextIdleDialogRunId({
              monitoringSucceeded:
                true,
              openRunId:
                openRunIdRef.current,
              activeRunId:
                confirmedActiveRun
                  ?.id ??
                null,
              idleEligible,
            });

          const previousActiveRunId =
            activeRunRef.current
              ?.id ??
            null;

          activeRunRef.current =
            confirmedActiveRun;

          setActiveRun(
            confirmedActiveRun,
          );

          updateOpenRunId(
            nextOpenRunId,
          );

          setMonitoringWarning(
            null,
          );

          if (
            previousActiveRunId !==
            confirmedActiveRun
              ?.id
          ) {
            setDetail(
              null,
            );
          }

          if (
            !confirmedActiveRun
          ) {
            setDetail(
              null,
            );

            return;
          }

          try {
            const nextDetail =
              await getRunMonitoringDetail(
                confirmedActiveRun.id,
                controller.signal,
              );

            if (
              controller.signal
                .aborted
            ) {
              return;
            }

            setDetail(
              nextDetail,
            );
          } catch (error) {
            if (
              controller.signal
                .aborted ||
              isAbortError(
                error,
              )
            ) {
              return;
            }

            setMonitoringWarning(
              `Run detail refresh failed. ${monitoringErrorMessage(
                error,
              )}`,
            );
          }
        } catch (error) {
          if (
            controller.signal
              .aborted ||
            isAbortError(
              error,
            )
          ) {
            return;
          }

          const preservedOpenRunId =
            nextIdleDialogRunId({
              monitoringSucceeded:
                false,
              openRunId:
                openRunIdRef.current,
              activeRunId:
                activeRunRef.current
                  ?.id ??
                null,
              idleEligible:
                false,
            });

          updateOpenRunId(
            preservedOpenRunId,
          );

          setMonitoringWarning(
            `Monitoring refresh failed. ${monitoringErrorMessage(
              error,
            )}`,
          );
        }
      },
      [
        ensureLastActivityAt,
        updateOpenRunId,
      ],
    );

  /**
   * Keeps the latest monitoring callback available to the ref-backed inactivity timeout.
   */
  useEffect(() => {
    loadMonitoringRef.current =
      loadMonitoring;

    return () => {
      loadMonitoringRef.current =
        null;
    };
  }, [
    loadMonitoring,
  ]);

  /**
   * Registers dashboard-scoped activity events without rendering on high-frequency input.
   */
  useEffect(() => {
    /**
     * Treats one dashboard interaction as fresh operator activity.
     */
    function handleActivity(): void {
      recordActivity();
    }

    ensureLastActivityAt();

    for (
      const eventName of
      DASHBOARD_ACTIVITY_EVENTS
    ) {
      document.addEventListener(
        eventName,
        handleActivity,
        activityListenerOptions(
          eventName,
        ),
      );
    }

    scheduleIdleCheck();

    return () => {
      for (
        const eventName of
        DASHBOARD_ACTIVITY_EVENTS
      ) {
        document.removeEventListener(
          eventName,
          handleActivity,
          activityListenerOptions(
            eventName,
          ),
        );
      }

      if (
        idleTimeoutRef.current !==
        null
      ) {
        window.clearTimeout(
          idleTimeoutRef.current,
        );

        idleTimeoutRef.current =
          null;
      }
    };
  }, [
    ensureLastActivityAt,
    recordActivity,
    scheduleIdleCheck,
  ]);

  /**
   * Polls authoritative run monitoring only while visible and catches up immediately on tab return.
   */
  useEffect(() => {
    let disposed =
      false;

    /**
     * Runs one monitoring cycle only when the dashboard can visibly present the result.
     */
    function tick(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void loadMonitoring();
      }
    }

    /**
     * Performs the first monitoring request after the client effect has mounted.
     */
    function handleInitialMonitoringLoad(): void {
      if (
        !disposed
      ) {
        tick();
      }
    }

    /**
     * Refreshes authoritative state immediately when the operator returns to a visible tab.
     */
    function handleVisibilityChange(): void {
      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }

      scheduleIdleCheck();
      tick();
    }

    queueMicrotask(
      handleInitialMonitoringLoad,
    );

    const timer =
      window.setInterval(
        tick,
        MONITOR_POLL_INTERVAL_MS,
      );

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      disposed =
        true;

      window.clearInterval(
        timer,
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );

      monitorAbortRef.current?.abort();
    };
  }, [
    loadMonitoring,
    scheduleIdleCheck,
  ]);

  /**
   * Handles explicit or Escape-based dialog dismissal as fresh user activity.
   */
  const handleDialogOpenChange =
    useCallback(
      (
        nextOpen:
          boolean,
      ): void => {
        if (
          nextOpen
        ) {
          return;
        }

        recordActivity();

        updateOpenRunId(
          null,
        );
      },
      [
        recordActivity,
        updateOpenRunId,
      ],
    );

  /**
   * Closes the idle dialog, records activity, and navigates to the authoritative Run Detail page.
   */
  const handleOpenRunDetail =
    useCallback(
      (): void => {
        const runId =
          openRunIdRef.current;

        if (!runId) {
          return;
        }

        recordActivity();

        updateOpenRunId(
          null,
        );

        router.push(
          `/runs/${runId}`,
        );
      },
      [
        recordActivity,
        router,
        updateOpenRunId,
      ],
    );

  const dialogRun =
    activeRun?.id ===
    openRunId
      ? activeRun
      : null;

  const dialogDetail =
    detail?.run.id ===
    openRunId
      ? detail
      : null;

  if (!dialogRun) {
    return null;
  }

  return (
    <IdleRunTerminalDialog
      run={
        dialogRun
      }
      detail={
        dialogDetail
      }
      monitoringWarning={
        monitoringWarning
      }
      onOpenChange={
        handleDialogOpenChange
      }
      onOpenRunDetail={
        handleOpenRunDetail
      }
    />
  );
}
