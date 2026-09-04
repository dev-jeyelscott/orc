const ANSI = {
  reset: "\u001b[0m",
  muted: "\u001b[38;5;245m",
  blue: "\u001b[38;5;111m",
  cyan: "\u001b[38;5;80m",
  green: "\u001b[38;5;78m",
  yellow: "\u001b[38;5;221m",
  red: "\u001b[38;5;203m",
  white: "\u001b[38;5;255m",
} as const;

type TerminalEvent = Record<string, unknown>;

/** Narrows an unknown stream-json value to a presentation-safe event object. */
function asTerminalEvent(value: unknown): TerminalEvent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as TerminalEvent;
}

/** Applies one ANSI color without allowing color state to leak into later output. */
function color(value: string, tone: keyof typeof ANSI): string {
  return `${ANSI[tone]}${value}${ANSI.reset}`;
}

/** Uses error and success cues within tool output without hiding any output text. */
function formatOutputLine(line: string): string {
  if (/\b(error|exception|failed|fail|fatal)\b/i.test(line)) {
    return color(line, "red");
  }

  if (/\b(pass|passed|success|completed)\b/i.test(line)) {
    return color(line, "green");
  }

  if (/\b(warn|warning|retry)\b/i.test(line)) {
    return color(line, "yellow");
  }

  if (/^\s*[$>#]/.test(line)) {
    return color(line, "cyan");
  }

  return color(line, "white");
}

/** Formats a multi-line tool response with a compact gutter and semantic colors. */
function formatOutput(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => `${color("│", "muted")} ${formatOutputLine(line)}`)
    .join("\r\n");
}

/** Reads a non-empty string property from a protocol event. */
function eventString(event: TerminalEvent, key: string): string | undefined {
  const value = event[key];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Formats Codex item lifecycle events using their structured item payload. */
function formatItemEvent(event: TerminalEvent, eventType: string): string | null {
  const item = asTerminalEvent(event["item"]);
  const itemType = item && eventString(item, "type");

  if (!item || !itemType) {
    return null;
  }

  const completed = eventType === "item.completed";

  if (itemType === "command_execution") {
    const command = eventString(item, "command") ?? "Command";
    const output = eventString(item, "aggregated_output");
    const exitCode = item["exit_code"];
    const failed = typeof exitCode === "number" && exitCode !== 0;

    if (!completed) {
      return `${color("›", "blue")} ${color("Command", "blue")}\r\n${color("$", "cyan")} ${color(command, "cyan")}`;
    }

    const label = failed ? "Command failed" : "Command finished";
    const tone = failed ? "red" : "green";
    const exitDetail =
      typeof exitCode === "number" ? ` · exit ${exitCode}` : "";

    return `${color(failed ? "◆" : "✓", tone)} ${color(label, tone)}${color(exitDetail, "muted")}${output ? `\r\n${formatOutput(output)}` : ""}`;
  }

  if (itemType === "agent_message") {
    const text = eventString(item, "text");

    return completed && text
      ? `${color("✦", "blue")} ${color("Agent", "blue")}\r\n${formatOutput(text)}`
      : null;
  }

  if (itemType === "reasoning") {
    const text = eventString(item, "text");

    return completed && text
      ? `${color("…", "muted")} ${color("Reasoning", "muted")}\r\n${formatOutput(text)}`
      : null;
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item["changes"])
      ? item["changes"].map(asTerminalEvent).filter(Boolean)
      : [];
    const paths = changes
      .map((change) => {
        const path = change && eventString(change, "path");
        const kind = change && eventString(change, "kind");

        return path ? `${kind ? `${kind} ` : ""}${path}` : undefined;
      })
      .filter((path): path is string => Boolean(path));

    return completed
      ? `${color("✓", "green")} ${color("Files changed", "green")}${paths.length > 0 ? `\r\n${formatOutput(paths.join("\n"))}` : ""}`
      : null;
  }

  if (itemType === "mcp_tool_call") {
    const server = eventString(item, "server") ?? "MCP";
    const tool = eventString(item, "tool") ?? "tool";
    const error = eventString(item, "error");
    const tone = error ? "red" : completed ? "green" : "blue";

    return `${color(completed ? (error ? "◆" : "✓") : "›", tone)} ${color(`${server} · ${tool}`, "cyan")} ${color(completed ? (error ? "failed" : "finished") : "running", tone)}${error ? `\r\n${formatOutput(error)}` : ""}`;
  }

  return completed
    ? `${color("✓", "green")} ${color(itemType.replaceAll("_", " "), "green")}`
    : null;
}

/** Turns one structured CLI protocol event into an operator-readable terminal entry. */
function formatTerminalEvent(event: TerminalEvent): string | null {
  const type = eventString(event, "type");
  const subtype = eventString(event, "subtype");

  if (type === "item.started" || type === "item.completed") {
    return formatItemEvent(event, type);
  }

  if (type === "tool_progress") {
    const toolName = eventString(event, "tool_name") ?? "Tool";
    const status = eventString(event, "status") ?? "running";
    const elapsedValue = event["elapsed_time_seconds"];
    const elapsed =
      typeof elapsedValue === "number"
        ? String(elapsedValue)
        : eventString(event, "elapsed_time_seconds");
    const tone = /fail|error/i.test(status)
      ? "red"
      : /complete|success/i.test(status)
        ? "green"
        : "blue";

    return `${color("●", tone)} ${color(toolName, "cyan")} ${color(status, tone)}${elapsed ? color(` · ${elapsed}s`, "muted") : ""}`;
  }

  if (type === "task_notification" || subtype === "task_notification") {
    const status = eventString(event, "status") ?? "updated";
    const summary = eventString(event, "summary");
    const tone = /fail|error/i.test(status) ? "red" : "blue";

    return `${color("◆", tone)} ${color("Task", "blue")} ${color(status, tone)}${summary ? `\r\n${formatOutput(summary)}` : ""}`;
  }

  if (type === "thinking_tokens" || subtype === "thinking_tokens") {
    const estimate = event["estimated_tokens"];
    const delta = event["estimated_tokens_delta"];
    const details = [
      typeof estimate === "number" ? `${estimate} tokens` : undefined,
      typeof delta === "number" ? `+${delta}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");

    return `${color("…", "muted")} ${color("Thinking", "muted")}${details ? color(` · ${details}`, "muted") : ""}`;
  }

  if (type === "user") {
    const message = asTerminalEvent(event["message"]);
    const content = Array.isArray(message?.["content"])
      ? message["content"]
      : [];
    const result = content
      .map(asTerminalEvent)
      .find((item) => item?.["type"] === "tool_result");
    const output = result && eventString(result, "content");

    return output
      ? `${color("↳", "blue")} ${color("Tool result", "blue")}\r\n${formatOutput(output)}`
      : null;
  }

  if (type === "assistant") {
    const message = asTerminalEvent(event["message"]);
    const content = Array.isArray(message?.["content"])
      ? message["content"]
      : [];
    const text = content
      .map(asTerminalEvent)
      .map((item) => eventString(item ?? {}, "text"))
      .filter((item): item is string => Boolean(item))
      .join("\n");

    return text
      ? `${color("✦", "blue")} ${color("Agent", "blue")}\r\n${formatOutput(text)}`
      : null;
  }

  if (type === "result") {
    const result = eventString(event, "result");
    const tone = /error|fail/i.test(subtype ?? "") ? "red" : "green";

    return `${color("◆", tone)} ${color("Run result", tone)}${result ? `\r\n${formatOutput(result)}` : ""}`;
  }

  if (type === "error") {
    return `${color("◆ Error", "red")} ${color(eventString(event, "error") ?? "Unknown terminal error", "red")}`;
  }

  return type
    ? `${color("•", "muted")} ${color(type.replaceAll("_", " "), "muted")}`
    : null;
}

/**
 * Buffers raw chunks until JSONL records are complete, then writes readable,
 * ANSI-colored event entries. Plain terminal output is passed through unchanged.
 */
export function createTerminalOutputFormatter() {
  let pending = "";

  function formatLine(line: string): string {
    try {
      const event = asTerminalEvent(JSON.parse(line));
      const formatted = event && formatTerminalEvent(event);

      return (
        formatted ??
        `${color("•", "muted")} ${color("Unrecognized protocol event", "muted")}`
      );
    } catch {
      return line;
    }
  }

  return {
    write(data: string): string {
      pending += data;
      const lines = pending.split(/\n/);
      pending = lines.pop() ?? "";

      const completeLines = lines
        .map((line) => formatLine(line.replace(/\r$/, "")))
        .join("\r\n");

      if (pending && !/^\s*\{/.test(pending)) {
        const rawOutput = pending;
        pending = "";

        return `${completeLines}${lines.length > 0 ? "\r\n" : ""}${rawOutput}`;
      }

      return `${completeLines}${lines.length > 0 ? "\r\n" : ""}`;
    },
    flush(): string {
      if (!pending) {
        return "";
      }

      const output = formatLine(pending.replace(/\r$/, ""));
      pending = "";
      return output;
    },
  };
}
