"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  terminalFrameSchema,
} from "@orc/shared";
import { TerminalIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import "@xterm/xterm/css/xterm.css";

import {
  getAgentExecution,
  getAgentExecutionTerminalUrl,
} from "@/lib/agent-executions";
import { cn } from "@/lib/utils";

type ConnectionStatus =
  | "connecting"
  | "streaming"
  | "complete"
  | "error";

interface AgentExecutionTerminalProps {
  executionId: string;
  title: string;
  className?: string;
}

const RECONNECT_DELAYS_MS = [
  250,
  500,
  1_000,
  2_000,
  4_000,
];

const ACTIVE_EXECUTION_STATUSES =
  new Set<string>([
    "pending",
    "starting",
    "running",
  ]);

/**
 * Renders one execution-scoped xterm terminal with persisted replay,
 * bounded reconnect, raw ANSI output, and PTY resize propagation.
 */
function AgentExecutionTerminal({
  executionId,
  title,
  className,
}: AgentExecutionTerminalProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const [status, setStatus] =
    useState<ConnectionStatus>(
      "connecting",
    );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const resolvedMonoFont =
      getComputedStyle(
        document.documentElement,
      )
        .getPropertyValue("--font-mono")
        .trim() || "monospace";

    const terminal = new Terminal({
      convertEol: false,
      fontFamily: resolvedMonoFont,
      fontSize: 13,
      scrollback: 10_000,
      theme: {
        background: "#0B0F14",
        foreground: "#C2CAD6",
      },
      disableStdin: true,
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(
      containerRef.current,
    );

    let socket:
      | WebSocket
      | null = null;

    let reconnectTimer:
      | ReturnType<
          typeof setTimeout
        >
      | undefined;

    let disposed = false;
    let finished = false;
    let reconnectAttempt = 0;
    let lastSequence = 0;

    /** Fits xterm to its container and forwards the resulting dimensions to the active PTY. */
    const fitAndSendResize =
      (): void => {
        if (disposed) {
          return;
        }

        try {
          fitAddon.fit();
        } catch {
          return;
        }

        if (
          socket?.readyState ===
            WebSocket.OPEN &&
          terminal.cols > 0 &&
          terminal.rows > 0
        ) {
          socket.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      };

    /** Checks persisted execution state before scheduling another WebSocket connection. */
    const scheduleReconnect =
      async (): Promise<void> => {
        if (
          disposed ||
          finished
        ) {
          return;
        }

        if (
          reconnectAttempt >=
          RECONNECT_DELAYS_MS.length
        ) {
          setStatus("error");
          return;
        }

        let execution;

        try {
          execution =
            await getAgentExecution(
              executionId,
            );
        } catch {
          setStatus("error");
          return;
        }

        if (
          !ACTIVE_EXECUTION_STATUSES.has(
            execution.status,
          )
        ) {
          finished = true;
          setStatus("complete");
          return;
        }

        const delay =
          RECONNECT_DELAYS_MS[
            reconnectAttempt
          ];

        reconnectAttempt += 1;
        setStatus("connecting");

        reconnectTimer = setTimeout(
          () => {
            if (
              !disposed &&
              !finished
            ) {
              connect();
            }
          },
          delay,
        );
      };

    /** Opens a terminal WebSocket from the last terminal-specific sequence already rendered. */
    const connect = (): void => {
      if (
        disposed ||
        finished
      ) {
        return;
      }

      const currentSocket =
        new WebSocket(
          getAgentExecutionTerminalUrl(
            executionId,
            lastSequence,
          ),
        );

      socket = currentSocket;

      currentSocket.addEventListener(
        "open",
        () => {
          if (disposed) {
            return;
          }

          setStatus("streaming");
          fitAndSendResize();
        },
      );

      currentSocket.addEventListener(
        "message",
        (event) => {
          let payload: unknown;

          try {
            payload = JSON.parse(
              event.data as string,
            );
          } catch {
            return;
          }

          const parsed =
            terminalFrameSchema.safeParse(
              payload,
            );

          if (!parsed.success) {
            return;
          }

          const frame =
            parsed.data;

          if (
            frame.type === "chunk"
          ) {
            if (
              frame.sequence <=
              lastSequence
            ) {
              return;
            }

            terminal.write(
              frame.data,
            );

            lastSequence =
              frame.sequence;

            return;
          }

          if (
            frame.type ===
            "complete"
          ) {
            finished = true;
            setStatus("complete");

            if (
              currentSocket.readyState ===
              WebSocket.OPEN
            ) {
              currentSocket.close(
                1000,
                "complete",
              );
            }

            return;
          }

          if (
            frame.type === "error"
          ) {
            finished = true;
            setStatus("error");

            if (
              currentSocket.readyState ===
                WebSocket.OPEN ||
              currentSocket.readyState ===
                WebSocket.CONNECTING
            ) {
              currentSocket.close();
            }
          }
        },
      );

      currentSocket.addEventListener(
        "close",
        () => {
          if (
            disposed ||
            finished
          ) {
            return;
          }

          void scheduleReconnect();
        },
      );

      currentSocket.addEventListener(
        "error",
        () => {
          if (
            !disposed &&
            !finished
          ) {
            setStatus("connecting");
          }
        },
      );
    };

    const resizeObserver =
      new ResizeObserver(() => {
        fitAndSendResize();
      });

    resizeObserver.observe(
      containerRef.current,
    );

    fitAndSendResize();
    setStatus("connecting");
    connect();

    return () => {
      disposed = true;

      if (reconnectTimer) {
        clearTimeout(
          reconnectTimer,
        );
      }

      resizeObserver.disconnect();

      if (
        socket?.readyState ===
          WebSocket.OPEN ||
        socket?.readyState ===
          WebSocket.CONNECTING
      ) {
        socket.close();
      }

      terminal.dispose();
    };
  }, [executionId]);

  const statusColor =
    status === "streaming"
      ? "bg-[#22C55E]"
      : status === "complete"
        ? "bg-[#8B93A3]"
        : status === "error"
          ? "bg-[#EF4444]"
          : "bg-[#F59E0B]";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-[#2A3342] bg-[#0B0F14]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-[#2A3342] px-3 py-2">
        <TerminalIcon className="size-3.5 text-[#8B93A3]" />
        <span className="text-sm font-medium text-[#E6E8F1]">
          {title}
        </span>
        <span
          className={cn(
            "ms-auto size-2 rounded-full",
            statusColor,
          )}
        />
      </div>

      <div
        ref={containerRef}
        className="h-[480px] px-3 py-3"
      />
    </div>
  );
}

export {
  AgentExecutionTerminal,
};
