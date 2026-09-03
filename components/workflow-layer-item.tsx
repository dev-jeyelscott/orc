import type { ReactNode } from "react"
import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

type WorkflowStatus = "completed" | "running" | "waiting"

const statusConfig: Record<
  WorkflowStatus,
  { icon: ReactNode; badgeVariant: "success" | "running" | "warning"; label: string; dot: string }
> = {
  completed: {
    icon: <CheckIcon className="size-3" />,
    badgeVariant: "success",
    label: "Completed",
    dot: "bg-status-success text-white",
  },
  running: {
    icon: <Loader2Icon className="size-3 animate-spin" />,
    badgeVariant: "running",
    label: "Running",
    dot: "bg-status-running text-white",
  },
  waiting: {
    icon: <CircleIcon className="size-2 fill-current" />,
    badgeVariant: "warning",
    label: "Waiting",
    dot: "bg-status-warning/20 text-status-warning",
  },
}

interface WorkflowLayerItemProps {
  layer: number
  role: string
  harness: string
  status: WorkflowStatus
  isLast?: boolean
}

function WorkflowLayerItem({ layer, role, harness, status, isLast }: WorkflowLayerItemProps) {
  const config = statusConfig[status]

  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className="absolute top-5 left-2.5 h-full w-px -translate-x-1/2 bg-divider"
        />
      )}
      <span
        className={cn(
          "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          config.dot
        )}
      >
        {config.icon}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-text-muted">Layer {layer}</span>
          <span className="truncate text-sm font-medium text-text-primary">{role}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline">{harness}</Badge>
          <Badge variant={config.badgeVariant}>{config.label}</Badge>
        </div>
      </div>
    </div>
  )
}

export { WorkflowLayerItem }
export type { WorkflowStatus }
