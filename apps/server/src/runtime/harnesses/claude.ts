import type { HarnessAdapter, StartWorkerInput, UnsequencedRuntimeEvent } from "../contracts.js";

const CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

function providerEvents(data: string): UnsequencedRuntimeEvent[] {
  return data.split(/\r?\n/).flatMap((line) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event === null || Array.isArray(event)) return [];
      const translated: UnsequencedRuntimeEvent[] = [{ type: "provider", provider: "claude", event }];
      if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) translated.push({ type: "usage", usage: event.usage as Record<string, unknown> });
      return translated;
    } catch {
      return [];
    }
  });
}

// Field names verified against a live `claude --print --output-format stream-json` invocation.
// Assistant turns are emitted as `{"type":"assistant","message":{"content":[{"type":"text",
// "text":"..."}], ...}}` (the content array can also include non-text blocks such as
// "thinking"). The final line is `{"type":"result","result":"<final text>", ...}`, which mirrors
// the concatenated text of the last assistant message and is used as a fallback in case the
// per-block extraction above misses anything.
function extractMessageText(event: Record<string, unknown>): string | undefined {
  if (event.type === "assistant") {
    const message = event.message as { content?: unknown } | undefined;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const text = blocks
      .filter((block): block is { type: string; text: string } => {
        return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string";
      })
      .map((block) => block.text)
      .join("");
    return text.length > 0 ? text : undefined;
  }
  if (event.type === "result" && typeof event.result === "string" && event.result.length > 0) {
    return event.result;
  }
  return undefined;
}

export const claudeHarness: HarnessAdapter = {
  harness: "claude",
  createInvocation(input: StartWorkerInput, prompt: string) {
    if (!CLAUDE_EFFORT_LEVELS.has(input.agent.reasoning)) {
      throw new Error(`Unsupported Claude effort level: ${input.agent.reasoning}`);
    }
    return {
      command: "claude",
      args: ["--print", "--output-format", "stream-json", "--verbose", "--model", input.agent.model, "--effort", input.agent.reasoning, prompt],
      cwd: input.projectPath,
    };
  },
  translateOutput: providerEvents,
  extractMessageText,
};
