"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  RUN_TIME_RANGE_OPTIONS,
  type RunChartBucket,
  type RunTimeRange,
} from "@/lib/run-observability";

const chartConfig = {
  count: {
    label: "Run starts",
    color:
      "var(--status-running)",
  },
} satisfies ChartConfig;

interface RunsOverTimeProps {
  data: RunChartBucket[];
  timeRange: RunTimeRange;
}

/**
 * Renders compact persisted run-start throughput only when the current time range contains activity.
 */
export function RunsOverTime({
  data,
  timeRange,
}: RunsOverTimeProps) {
  const hasActivity =
    data.some(
      (bucket) =>
        bucket.count > 0,
    );

  if (!hasActivity) {
    return null;
  }

  const label =
    RUN_TIME_RANGE_OPTIONS.find(
      (option) =>
        option.value ===
        timeRange,
    )?.label ??
    "Selected range";

  return (
    <Card
      size="sm"
      className="min-w-0"
    >
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>
            Runs over time
          </CardTitle>

          <p className="mt-0.5 text-[11px] text-text-muted">
            Persisted workflow starts
          </p>
        </div>

        <span className="text-[11px] text-text-muted">
          {label}
        </span>
      </CardHeader>

      <CardContent>
        <ChartContainer
          config={
            chartConfig
          }
          className="h-28 w-full aspect-auto"
          initialDimension={{
            width: 960,
            height: 112,
          }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{
              left: 0,
              right: 0,
              top: 4,
              bottom: 0,
            }}
          >
            <CartesianGrid
              vertical={false}
            />

            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />

            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent />
              }
            />

            <Bar
              dataKey="count"
              fill="var(--color-count)"
              radius={[
                2,
                2,
                0,
                0,
              ]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
