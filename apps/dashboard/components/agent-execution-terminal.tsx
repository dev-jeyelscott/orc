"use client";

import { TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { TerminalFrame } from "@orc/shared";

import "@xterm/xterm/css/xterm.css";

import { cn } from "@/lib/utils";
import { getAgentExecutionTerminalUrl } from "@/lib/agent-executions";

type ConnectionStatus = "connecting" | "streaming" | "complete" | "error";

interface AgentExecutionTerminalProps {
  executionId: string;
  title: string;
  className?: string;
}

/**
 * Terminal chrome mirrors TerminalPanel (dark, independent of app theme) but mounts a real
 * xterm.js instance that replays persisted `terminal_chunks` then streams live output over the
 * agent-execution WebSocket.
 */
function AgentExecutionTerminal({ executionId, title, className }: AgentExecutionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 13,
      theme: { background: "#0B0F14", foreground: "#C2CAD6" },
      disableStdin: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    setStatus("connecting");
    const socket = new WebSocket(getAgentExecutionTerminalUrl(executionId));

    socket.addEventListener("open", () => setStatus("streaming"));
    socket.addEventListener("message", (event) => {
      let frame: TerminalFrame;
      try {
        frame = JSON.parse(event.data as string) as TerminalFrame;
      } catch {
        return;
      }
      if (frame.type === "chunk") {
        terminal.write(frame.data);
      } else if (frame.type === "complete") {
        setStatus("complete");
      } else if (frame.type === "error") {
        setStatus("error");
        terminal.write(`\r\n\x1b[31m${frame.error}\x1b[0m\r\n`);
      }
    });
    socket.addEventListener("close", () => {
      setStatus((current) => (current === "error" ? current : "complete"));
    });
    socket.addEventListener("error", () => setStatus("error"));

    return () => {
      resizeObserver.disconnect();
      socket.close();
      terminal.dispose();
    };
  }, [executionId]);

  const statusColor =
    status === "streaming" ? "bg-[#22C55E]" : status === "complete" ? "bg-[#8B93A3]" : status === "error" ? "bg-[#EF4444]" : "bg-[#F59E0B]";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-[#2A3342] bg-[#0B0F14]", className)}>
      <div className="flex items-center gap-2 border-b border-[#2A3342] px-3 py-2">
        <TerminalIcon className="size-3.5 text-[#8B93A3]" />
        <span className="text-sm font-medium text-[#E6E8F1]">{title}</span>
        <span className={cn("ms-auto size-2 rounded-full", statusColor)} />
      </div>
      <div ref={containerRef} className="h-[480px] px-3 py-3" />
    </div>
  );
}

export { AgentExecutionTerminal };
