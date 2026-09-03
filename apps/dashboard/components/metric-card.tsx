import type { ReactNode } from "react";
import {
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  description?: string;
  icon?: ReactNode;
  delta?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
  trend?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Renders a compact reusable operational metric using the shared design-system card tokens.
 */
function MetricCard({
  label,
  value,
  description,
  icon,
  delta,
  trend,
  footer,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("min-w-0 gap-3", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-xs font-medium text-text-muted">
            {label}
          </CardTitle>
          {description ? (
            <p className="mt-1 truncate text-[11px] text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {icon ? (
          <div className="shrink-0 text-text-muted">
            {icon}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-heading text-2xl font-semibold text-text-primary">
              {value}
            </span>

            {delta ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  delta.direction === "up" &&
                    "text-status-success",
                  delta.direction === "down" &&
                    "text-status-error",
                  delta.direction === "neutral" &&
                    "text-text-muted",
                )}
              >
                {delta.direction === "up" ? (
                  <TrendingUpIcon className="size-3.5" />
                ) : null}
                {delta.direction === "down" ? (
                  <TrendingDownIcon className="size-3.5" />
                ) : null}
                {delta.value}
              </span>
            ) : null}
          </div>

          {trend ? (
            <div className="shrink-0 text-status-success">
              {trend}
            </div>
          ) : null}
        </div>

        {footer ? (
          <div className="min-w-0 text-xs text-text-muted">
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { MetricCard };
