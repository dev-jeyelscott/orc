import { TerminalIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type TerminalLineType = "command" | "output" | "pass" | "fail" | "status" | "prompt"

interface TerminalLine {
  type: TerminalLineType
  text: string
}

interface TerminalPanelProps {
  title: string
  lines: TerminalLine[]
  className?: string
}

/**
 * Terminal chrome is always dark, independent of the app theme -- matches
 * how real terminals conventionally render regardless of surrounding UI.
 */
function TerminalPanel({ title, lines, className }: TerminalPanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-[#2A3342] bg-[#0B0F14]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-[#2A3342] px-3 py-2">
        <TerminalIcon className="size-3.5 text-[#8B93A3]" />
        <span className="text-sm font-medium text-[#E6E8F1]">{title}</span>
        <span className="ms-auto size-2 rounded-full bg-[#22C55E]" />
      </div>
      <div className="space-y-1 px-3 py-3 font-mono text-[13px] leading-5">
        {lines.map((line, index) => (
          <TerminalLineRow key={index} line={line} />
        ))}
      </div>
    </div>
  )
}

function TerminalLineRow({ line }: { line: TerminalLine }) {
  switch (line.type) {
    case "command":
      return (
        <p className="text-[#E6E8F1]">
          <span className="text-[#61AAFF]">$</span> {line.text}
        </p>
      )
    case "pass":
      return (
        <p className="text-[#C2CAD6]">
          <span className="text-[#22C55E]">PASS</span> {line.text}
        </p>
      )
    case "fail":
      return (
        <p className="text-[#C2CAD6]">
          <span className="text-[#EF4444]">FAIL</span> {line.text}
        </p>
      )
    case "status":
      return <p className="text-[#8B93A3]">{line.text}</p>
    case "prompt":
      return (
        <p className="text-[#E6E8F1]">
          <span className="text-[#61AAFF]">$</span> {line.text}
          <span className="ms-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#E6E8F1] align-middle" />
        </p>
      )
    case "output":
    default:
      return <p className="text-[#C2CAD6]">{line.text}</p>
  }
}

export { TerminalPanel }
export type { TerminalLine, TerminalLineType }
