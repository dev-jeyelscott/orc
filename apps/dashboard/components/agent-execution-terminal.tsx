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
  heightClassName?: string;
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

/** Returns the human-readable terminal connection state used by the panel header. */
function connectionLabel(
  status: ConnectionStatus,
): string {
  switch (status) {
    case "streaming":
      return "Live";
    case "complete":
      return "Complete";
    case "error":
      return "Disconnected";
    case "connecting":
    default:
      return "Connecting";
  }
}

/** Returns the semantic design-system class for one terminal connection state. */
function connectionClassName(
  status: ConnectionStatus,
): string {
  switch (status) {
    case "streaming":
      return "bg-status-success";
    case "complete":
      return "bg-status-neutral";
    case "error":
      return "bg-status-error";
    case "connecting":
    default:
      return "bg-status-warning";
  }
}

/**
 * Renders one execution-scoped xterm terminal with persisted replay,
 * bounded reconnect, raw ANSI output, and PTY resize propagation.
 */
export function AgentExecutionTerminal({
  executionId,
  title,
  className,
  heightClassName = "h-[480px]",
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

    const rootStyles =
      getComputedStyle(
        document.documentElement,
      );

    const containerStyles =
      getComputedStyle(
        containerRef.current,
      );

    const resolvedMonoFont =
      rootStyles
        .getPropertyValue(
          "--font-mono",
        )
        .trim() || "monospace";

    const background =
      rootStyles
        .getPropertyValue(
          "--bg-app",
        )
        .trim() ||
      containerStyles.backgroundColor;

    const foreground =
      rootStyles
        .getPropertyValue(
          "--text-secondary",
        )
        .trim() ||
      containerStyles.color;

    const cursor =
      rootStyles
        .getPropertyValue(
          "--text-primary",
        )
        .trim() ||
      foreground;

    const selectionBackground =
      rootStyles
        .getPropertyValue(
          "--surface-interactive",
        )
        .trim() ||
      background;

    const terminal =
      new Terminal({
        convertEol: false,
        fontFamily:
          resolvedMonoFont,
        fontSize: 13,
        scrollback: 10_000,
        theme: {
          background,
          foreground,
          cursor,
          selectionBackground,
        },
        disableStdin: true,
      });

    const fitAddon =
      new FitAddon();

    terminal.loadAddon(
      fitAddon,
    );

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

        reconnectTimer =
          setTimeout(
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
    const connect =
      (): void => {
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

        socket =
          currentSocket;

        currentSocket.addEventListener(
          "open",
          () => {
            if (disposed) {
              return;
            }

            reconnectAttempt = 0;
            setStatus(
              "streaming",
            );

            fitAndSendResize();
          },
        );

        currentSocket.addEventListener(
          "message",
          (event) => {
            let payload: unknown;

            try {
              payload =
                JSON.parse(
                  event.data as string,
                );
            } catch {
              return;
            }

            const parsed =
              terminalFrameSchema.safeParse(
                payload,
              );

            if (
              !parsed.success
            ) {
              return;
            }

            const frame =
              parsed.data;

            if (
              frame.type ===
              "chunk"
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

              setStatus(
                "complete",
              );

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
              frame.type ===
              "error"
            ) {
              finished = true;

              setStatus(
                "error",
              );

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
              setStatus(
                "connecting",
              );
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

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border-default bg-bg-app",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-2">
        <TerminalIcon className="size-3.5 text-text-muted" />

        <span className="truncate text-sm font-medium text-text-primary">
          {title}
        </span>

        <span className="ms-auto flex items-center gap-1.5 text-[11px] text-text-muted">
          <span
            className={cn(
              "size-2 rounded-full",
              connectionClassName(
                status,
              ),
            )}
          />

          {connectionLabel(
            status,
          )}
        </span>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "bg-bg-app px-3 py-3",
          heightClassName,
        )}
      />
    </div>
  );
}
