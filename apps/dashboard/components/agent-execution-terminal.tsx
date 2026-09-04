"use client";

import {
  FitAddon,
} from "@xterm/addon-fit";
import {
  Terminal,
} from "@xterm/xterm";
import {
  terminalFrameSchema,
} from "@orc/shared";
import {
  CopyIcon,
  Maximize2Icon,
  Minimize2Icon,
  TerminalIcon,
} from "lucide-react";
import type {
  ReactNode,
} from "react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import "@xterm/xterm/css/xterm.css";

import {
  Button,
} from "@/components/ui/button";
import {
  getAgentExecution,
  getAgentExecutionTerminalUrl,
} from "@/lib/agent-executions";
import {
  createTerminalOutputFormatter,
} from "@/lib/terminal-output";
import {
  cn,
} from "@/lib/utils";

type ConnectionStatus =
  | "connecting"
  | "streaming"
  | "complete"
  | "error";

interface AgentExecutionTerminalProps {
  executionId:
    string;
  title: string;
  className?: string;
  heightClassName?: string;
  subheader?: ReactNode;
  showControls?: boolean;
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
 * Returns the human-readable terminal connection state used by the panel header.
 */
function connectionLabel(
  status:
    ConnectionStatus,
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

/**
 * Returns the semantic design-system class for one terminal connection state.
 */
function connectionClassName(
  status:
    ConnectionStatus,
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
 * Resolves the current design-system terminal theme from CSS variables.
 */
function resolveTerminalTheme(
  container:
    HTMLDivElement,
) {
  const rootStyles =
    getComputedStyle(
      document.documentElement,
    );

  const containerStyles =
    getComputedStyle(
      container,
    );

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

  return {
    background,
    foreground,
    cursor,
    selectionBackground,
  };
}

/**
 * Resolves the current design-system monospace font family for xterm.
 */
function resolveTerminalFont(): string {
  return (
    getComputedStyle(
      document.documentElement,
    )
      .getPropertyValue(
        "--font-mono",
      )
      .trim() ||
    "monospace"
  );
}

/**
 * Reads the currently replayed xterm buffer as plain text for the local Copy control.
 */
function terminalBufferText(
  terminal:
    Terminal,
): string {
  const buffer =
    terminal.buffer.active;

  const lines:
    string[] = [];

  for (
    let index = 0;
    index <
    buffer.length;
    index += 1
  ) {
    const line =
      buffer.getLine(
        index,
      );

    if (!line) {
      continue;
    }

    lines.push(
      line.translateToString(
        true,
      ),
    );
  }

  return lines
    .join("\n")
    .trimEnd();
}

/**
 * Renders one execution-scoped xterm terminal with persisted replay, bounded reconnect, raw ANSI output, PTY resize propagation, and optional local operator controls.
 */
export function AgentExecutionTerminal({
  executionId,
  title,
  className,
  heightClassName =
    "h-[480px]",
  subheader,
  showControls =
    false,
}: AgentExecutionTerminalProps) {
  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const terminalRef =
    useRef<Terminal | null>(
      null,
    );

  const [
    status,
    setStatus,
  ] =
    useState<ConnectionStatus>(
      "connecting",
    );

  const [
    expanded,
    setExpanded,
  ] =
    useState(false);

  /**
   * Copies the currently rendered terminal buffer without adding a server-side history API.
   */
  async function copyTerminalOutput(): Promise<void> {
    const terminal =
      terminalRef.current;

    if (!terminal) {
      return;
    }

    const value =
      terminalBufferText(
        terminal,
      );

    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        value,
      );
    } catch {
      // Clipboard support is optional and must not interrupt terminal observation.
    }
  }

  useEffect(() => {
    if (!expanded) {
      return;
    }

    /**
     * Exits the local expanded terminal view when the operator presses Escape.
     */
    function handleKeyDown(
      event:
        KeyboardEvent,
    ): void {
      if (
        event.key ===
        "Escape"
      ) {
        setExpanded(
          false,
        );
      }
    }

    document.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [
    expanded,
  ]);

  useEffect(() => {
    const container =
      containerRef.current;

    if (!container) {
      return;
    }

    const terminal =
      new Terminal({
        convertEol:
          false,
        fontFamily:
          resolveTerminalFont(),
        fontSize: 13,
        scrollback:
          10_000,
        theme:
          resolveTerminalTheme(
            container,
          ),
        disableStdin:
          true,
      });

    terminalRef.current =
      terminal;

    const fitAddon =
      new FitAddon();

    terminal.loadAddon(
      fitAddon,
    );

    terminal.open(
      container,
    );

    const outputFormatter =
      createTerminalOutputFormatter();

    let socket:
      | WebSocket
      | null = null;

    let reconnectTimer:
      | ReturnType<
          typeof setTimeout
        >
      | undefined;

    let disposed =
      false;

    let finished =
      false;

    let reconnectAttempt =
      0;

    let lastSequence =
      0;

    const reconnectRequestController =
      new AbortController();

    /**
     * Fits xterm to its container and forwards dimensions to the active PTY.
     */
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
          terminal.cols >
            0 &&
          terminal.rows >
            0
        ) {
          socket.send(
            JSON.stringify({
              type:
                "resize",
              cols:
                terminal.cols,
              rows:
                terminal.rows,
            }),
          );
        }
      };

    /**
     * Applies current light or dark design-system tokens without rebuilding the terminal session.
     */
    const handleThemeChange =
      (): void => {
        if (
          disposed
        ) {
          return;
        }

        terminal.options.theme =
          resolveTerminalTheme(
            container,
          );
      };

    /**
     * Checks persisted execution state before scheduling another WebSocket connection.
     */
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
          setStatus(
            "error",
          );
          return;
        }

        let execution;

        try {
          execution =
            await getAgentExecution(
              executionId,
              reconnectRequestController.signal,
            );
        } catch {
          if (
            disposed ||
            reconnectRequestController.signal
              .aborted
          ) {
            return;
          }

          setStatus(
            "error",
          );
          return;
        }

        if (
          disposed ||
          reconnectRequestController.signal
            .aborted
        ) {
          return;
        }

        if (
          !ACTIVE_EXECUTION_STATUSES.has(
            execution.status,
          )
        ) {
          finished =
            true;

          setStatus(
            "complete",
          );
          return;
        }

        const delay =
          RECONNECT_DELAYS_MS[
            reconnectAttempt
          ];

        reconnectAttempt +=
          1;

        setStatus(
          "connecting",
        );

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

    /**
     * Opens a terminal WebSocket from the last terminal-specific sequence already rendered.
     */
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
            if (
              disposed
            ) {
              return;
            }

            reconnectAttempt =
              0;

            setStatus(
              "streaming",
            );

            fitAndSendResize();
          },
        );

        currentSocket.addEventListener(
          "message",
          (
            event,
          ) => {
            let payload:
              unknown;

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
                outputFormatter.write(
                  frame.data,
                ),
              );

              lastSequence =
                frame.sequence;

              return;
            }

            if (
              frame.type ===
              "complete"
            ) {
              const remainingOutput =
                outputFormatter.flush();

              if (
                remainingOutput
              ) {
                terminal.write(
                  remainingOutput,
                );
              }

              finished =
                true;

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
              const remainingOutput =
                outputFormatter.flush();

              if (
                remainingOutput
              ) {
                terminal.write(
                  remainingOutput,
                );
              }

              finished =
                true;

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
      new ResizeObserver(
        () => {
          fitAndSendResize();
        },
      );

    const themeObserver =
      new MutationObserver(
        handleThemeChange,
      );

    resizeObserver.observe(
      container,
    );

    themeObserver.observe(
      document.documentElement,
      {
        attributes:
          true,
        attributeFilter: [
          "class",
          "style",
        ],
      },
    );

    fitAndSendResize();

    setStatus(
      "connecting",
    );

    connect();

    return () => {
      disposed =
        true;

      reconnectRequestController.abort();

      if (
        reconnectTimer
      ) {
        clearTimeout(
          reconnectTimer,
        );
      }

      resizeObserver.disconnect();
      themeObserver.disconnect();

      if (
        socket?.readyState ===
          WebSocket.OPEN ||
        socket?.readyState ===
          WebSocket.CONNECTING
      ) {
        socket.close();
      }

      if (
        terminalRef.current ===
        terminal
      ) {
        terminalRef.current =
          null;
      }

      terminal.dispose();
    };
  }, [
    executionId,
  ]);

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-default bg-bg-app shadow-xs",
        expanded &&
          "fixed inset-3 z-50 bg-bg-app shadow-lg sm:inset-6",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default bg-surface-elevated px-3">
        <TerminalIcon className="size-3.5 shrink-0 text-text-muted" />

        <span
          title={
            title
          }
          className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary"
        >
          {title}
        </span>

        <span
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-1.5 text-[10px] text-text-muted"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              connectionClassName(
                status,
              ),
            )}
          />

          {connectionLabel(
            status,
          )}
        </span>

        {showControls ? (
          <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-divider pl-2">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title="Copy terminal output"
              aria-label="Copy terminal output"
              onClick={() =>
                void copyTerminalOutput()
              }
            >
              <CopyIcon />
            </Button>

            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={
                expanded
                  ? "Collapse terminal"
                  : "Expand terminal"
              }
              aria-label={
                expanded
                  ? "Collapse terminal"
                  : "Expand terminal"
              }
              aria-pressed={
                expanded
              }
              onClick={() =>
                setExpanded(
                  (
                    current,
                  ) =>
                    !current,
                )
              }
            >
              {expanded ? (
                <Minimize2Icon />
              ) : (
                <Maximize2Icon />
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {subheader ? (
        <div className="flex min-h-8 shrink-0 items-center overflow-hidden border-b border-border-default bg-surface-interactive/30 px-3">
          {subheader}
        </div>
      ) : null}

      <div
        ref={
          containerRef
        }
        className={cn(
          "min-h-0 overflow-hidden bg-bg-app px-3 py-3",
          expanded
            ? "flex-1"
            : heightClassName,
        )}
      />
    </div>
  );
}
