import type { ReactNode } from "react"
import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

type TimelineStatus = "success" | "progress" | "pending"

const statusConfig: Record<TimelineStatus, { icon: ReactNode; dot: string }> = {
  success: {
    icon: <CheckIcon className="size-3" />,
    dot: "bg-status-success text-white",
  },
  progress: {
    icon: <Loader2Icon className="size-3 animate-spin" />,
    dot: "bg-status-running text-white",
  },
  pending: {
    icon: <CircleIcon className="size-2 fill-current" />,
    dot: "bg-status-neutral/20 text-status-neutral",
  },
}

interface TimelineEntry {
  timestamp: string
  description: string
  status: TimelineStatus
}

interface TimelineProps {
  entries: TimelineEntry[]
  className?: string
}

function Timeline({ entries, className }: TimelineProps) {
  return (
    <div className={className}>
      {entries.map((entry, index) => {
        const config = statusConfig[entry.status]
        const isLast = index === entries.length - 1

        return (
          <div key={`${entry.timestamp}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
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
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-text-muted">{entry.timestamp}</span>
              <span className="text-sm text-text-primary">{entry.description}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { Timeline }
export type { TimelineEntry, TimelineStatus }
