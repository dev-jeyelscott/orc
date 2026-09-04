"use client";

import {
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  RUN_TIME_RANGE_OPTIONS,
  formatRelativeTime,
  type RunTimeRange,
} from "@/lib/run-observability";
import { cn } from "@/lib/utils";

interface RunsHeaderProps {
  search: string;
  onSearchChange: (
    value: string,
  ) => void;
  timeRange: RunTimeRange;
  onTimeRangeChange: (
    value: RunTimeRange,
  ) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (
    value: boolean,
  ) => void;
  refreshing: boolean;
  lastSyncedAt:
    | number
    | null;
  onRefresh: () => void;
}

/**
 * Renders the Runs title and the single authoritative global monitoring control row.
 */
export function RunsHeader({
  search,
  onSearchChange,
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onAutoRefreshChange,
  refreshing,
  lastSyncedAt,
  onRefresh,
}: RunsHeaderProps) {
  return (
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold text-text-primary">
          Runs
        </h1>

        <p className="mt-1 text-sm text-text-muted">
          Monitor live workflows and inspect historical runs.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
        <div className="relative min-w-0 sm:w-72">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />

          <Input
            value={search}
            onChange={(event) =>
              onSearchChange(
                event.target.value,
              )
            }
            placeholder="Search runs..."
            aria-label="Search runs"
            className="pl-8"
          />
        </div>

        <select
          value={timeRange}
          onChange={(event) =>
            onTimeRangeChange(
              event.target
                .value as RunTimeRange,
            )
          }
          aria-label="Run history time range"
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-text-secondary outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {RUN_TIME_RANGE_OPTIONS.map(
            (option) => (
              <option
                key={
                  option.value
                }
                value={
                  option.value
                }
              >
                {option.label}
              </option>
            ),
          )}
        </select>

        <Button
          variant="outline"
          size="sm"
          onClick={
            onRefresh
          }
          aria-label="Refresh runs"
        >
          <RefreshCwIcon
            className={cn(
              "size-3.5",
              refreshing &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
          Refresh
        </Button>

        <label className="flex h-8 items-center gap-2 rounded-lg border border-border-default px-2.5 text-xs text-text-secondary">
          <span>
            {autoRefresh
              ? "Live 2s"
              : "Paused"}
          </span>

          <Switch
            size="sm"
            checked={
              autoRefresh
            }
            onCheckedChange={
              onAutoRefreshChange
            }
            aria-label="Auto refresh runs"
          />
        </label>

        {lastSyncedAt ? (
          <span className="hidden whitespace-nowrap text-[11px] text-text-muted 2xl:inline">
            Synced{" "}
            {formatRelativeTime(
              new Date(
                lastSyncedAt,
              ).toISOString(),
            )}
          </span>
        ) : null}
      </div>
    </header>
  );
}
