import type { ReactNode } from "react"
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MetricCardProps {
  label: string
  value: string
  delta?: {
    value: string
    direction: "up" | "down" | "neutral"
  }
  trend?: ReactNode
  className?: string
}

function MetricCard({ label, value, delta, trend, className }: MetricCardProps) {
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-text-muted">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-2xl font-semibold text-text-primary">
            {value}
          </span>
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                delta.direction === "up" && "text-status-success",
                delta.direction === "down" && "text-status-error",
                delta.direction === "neutral" && "text-text-muted"
              )}
            >
              {delta.direction === "up" && <TrendingUpIcon className="size-3.5" />}
              {delta.direction === "down" && <TrendingDownIcon className="size-3.5" />}
              {delta.value}
            </span>
          ) : null}
        </div>
        {trend ? <div className="text-status-success">{trend}</div> : null}
      </CardContent>
    </Card>
  )
}

export { MetricCard }
