import { Progress } from "@/components/ui/progress"

interface ContextUsageProps {
  label: string
  percent: number
  current: string
  total: string
  className?: string
}

function ContextUsage({ label, percent, current, total, className }: ContextUsageProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-text-secondary">{label}</span>
        <span className="font-medium text-text-primary">{percent}%</span>
      </div>
      <Progress value={percent} />
      <p className="mt-1.5 text-xs text-text-muted">
        {current} / {total} tokens
      </p>
    </div>
  )
}

export { ContextUsage }
