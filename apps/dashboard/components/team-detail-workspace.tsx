"use client";

import { ArrowLeftIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Team } from "@orc/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { TeamWorkflowManager } from "@/components/team-workflow-manager";
import { getTeam } from "@/lib/teams";

/**
 * Converts one unknown Team workspace failure into concise operator-facing text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load Team";
}

/**
 * Detects fetch cancellation so route changes do not surface false errors.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Loads one Team and renders its dedicated Agents and Workflow workspace.
 */
export function TeamDetailWorkspace({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  /**
   * Loads the current Team while cancelling any stale request for the same route workspace.
   */
  const loadTeam = useCallback(async () => {
    requestRef.current?.abort();

    const controller = new AbortController();

    requestRef.current = controller;
    setStatus("loading");
    setError(null);

    try {
      const nextTeam = await getTeam(teamId, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setTeam(nextTeam);
      setStatus("loaded");
    } catch (caught) {
      if (isAbortError(caught)) {
        return;
      }

      setTeam(null);
      setError(errorMessage(caught));
      setStatus("error");
    }
  }, [teamId]);

  useEffect(() => {
    let disposed = false;

    queueMicrotask(() => {
      if (!disposed) {
        void loadTeam();
      }
    });

    return () => {
      disposed = true;
      requestRef.current?.abort();
    };
  }, [loadTeam]);

  if (status === "loading" && !team) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/teams" />}
          className="w-fit"
        >
          <ArrowLeftIcon />
          Teams
        </Button>

        <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
          <Spinner className="size-6" />
          <EmptyTitle>Loading Team...</EmptyTitle>
        </Empty>
      </div>
    );
  }

  if (status === "error" || !team) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/teams" />}
          className="w-fit"
        >
          <ArrowLeftIcon />
          Teams
        </Button>

        <Empty className="min-h-[28rem] border border-border-default bg-surface-elevated">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>

            <EmptyTitle>Team unavailable</EmptyTitle>

            <EmptyDescription>
              {error ?? "The requested Team could not be loaded."}
            </EmptyDescription>
          </EmptyHeader>

          <EmptyContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadTeam()}
            >
              <RefreshCwIcon />
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <header className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href="/teams" />}
          className="w-fit -ml-2"
        >
          <ArrowLeftIcon />
          Teams
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold text-text-primary">
                {team.name}
              </h1>

              <Badge variant={team.enabled ? "success" : "disabled"}>
                {team.enabled ? "Enabled" : "Disabled"}
              </Badge>

              <Badge variant={team.autoModeEnabled ? "success" : "disabled"}>
                Auto Mode {team.autoModeEnabled ? "On" : "Off"}
              </Badge>
            </div>

            <p className="mt-1 max-w-3xl text-sm text-text-muted">
              {team.description ||
                "Manage this Team's Agents and configured execution workflow."}
            </p>

            <p className="mt-1 font-mono text-[11px] text-text-muted">
              {team.slug}
            </p>
          </div>
        </div>
      </header>

      <TeamWorkflowManager key={team.id} team={team} />
    </div>
  );
}
