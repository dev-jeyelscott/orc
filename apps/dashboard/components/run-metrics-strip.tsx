import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ListChecksIcon,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import type {
  RunMetrics,
} from "@/lib/run-observability";

interface RunMetricsStripProps {
  metrics: RunMetrics;
}

/**
 * Renders the four fleet-level run health metrics approved for the primary Runs hierarchy.
 */
export function RunMetricsStrip({
  metrics,
}: RunMetricsStripProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Running Now"
        value={String(
          metrics.running,
        )}
        icon={
          <ActivityIcon className="size-4 text-status-running" />
        }
      />

      <MetricCard
        label="Queue / Pending"
        value={String(
          metrics.pending,
        )}
        icon={
          <ListChecksIcon className="size-4 text-status-warning" />
        }
      />

      <MetricCard
        label="Success Rate"
        value={
          metrics.successRate ===
          null
            ? "Unavailable"
            : `${metrics.successRate.toFixed(
                1,
              )}%`
        }
        icon={
          <CheckCircle2Icon className="size-4 text-status-success" />
        }
      />

      <MetricCard
        label="Failed / Blocked"
        value={String(
          metrics.failedBlocked,
        )}
        icon={
          <CircleAlertIcon className="size-4 text-status-error" />
        }
      />
    </div>
  );
}
