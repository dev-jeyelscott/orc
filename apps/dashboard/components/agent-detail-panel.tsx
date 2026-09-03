import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface AgentDetailPanelProps {
  title: string
  fields: Array<{ label: string; value: string }>
  className?: string
}

function AgentDetailPanel({ title, fields, className }: AgentDetailPanelProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-text-muted">{field.label}</dt>
              <dd className="text-end font-mono text-xs text-text-primary">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export { AgentDetailPanel }
