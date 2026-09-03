import type {
  HarnessAdapter,
  StartWorkerInput,
  UnsequencedRuntimeEvent,
} from "../contracts.js";

const CLAUDE_EFFORT_LEVELS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** Converts complete Claude stream-json lines into normalized provider and usage events. */
function providerEvents(data: string): UnsequencedRuntimeEvent[] {
  return data.split(/\r?\n/).flatMap((line) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;

      if (event === null || Array.isArray(event)) {
        return [];
      }

      const translated: UnsequencedRuntimeEvent[] = [
        {
          type: "provider",
          provider: "claude",
          event,
        },
      ];

      if (
        event.usage
        && typeof event.usage === "object"
        && !Array.isArray(event.usage)
      ) {
        translated.push({
          type: "usage",
          usage: event.usage as Record<string, unknown>,
        });
      }

      return translated;
    } catch {
      return [];
    }
  });
}

/**
 * Extracts assistant-authored text from Claude assistant or final result events.
 *
 * Verified provider shapes:
 * assistant.message.content[].text
 * result.result
 */
function extractMessageText(
  event: Record<string, unknown>,
): string | undefined {
  if (event.type === "assistant") {
    const message = event.message as { content?: unknown } | undefined;
    const blocks = Array.isArray(message?.content)
      ? message.content
      : [];

    const text = blocks
      .filter(
        (
          block,
        ): block is {
          type: string;
          text: string;
        } => {
          return (
            typeof block === "object"
            && block !== null
            && (block as { type?: unknown }).type === "text"
            && typeof (block as { text?: unknown }).text === "string"
          );
        },
      )
      .map((block) => block.text)
      .join("");

    return text.length > 0 ? text : undefined;
  }

  if (
    event.type === "result"
    && typeof event.result === "string"
    && event.result.length > 0
  ) {
    return event.result;
  }

  return undefined;
}

export const claudeHarness: HarnessAdapter = {
  harness: "claude",

  /** Builds the current one-shot Claude CLI invocation. */
  createInvocation(
    input: StartWorkerInput,
    prompt: string,
    environment: NodeJS.ProcessEnv,
  ) {
    if (!CLAUDE_EFFORT_LEVELS.has(input.agent.reasoning)) {
      throw new Error(
        `Unsupported Claude effort level: ${input.agent.reasoning}`,
      );
    }

    return {
      command: "claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(input.agent.model === "default"
          ? []
          : ["--model", input.agent.model]),
        "--effort",
        input.agent.reasoning,
        prompt,
      ],
      cwd: input.projectPath,
      env: environment,
    };
  },

  translateOutput: providerEvents,
  extractMessageText,
};
