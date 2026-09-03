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

/** Extracts Claude's final result text from the terminal result event. */
function extractMessageText(
  event: Record<string, unknown>,
): string | undefined {
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

    const allowedTools = [
      ...(input.agent.canWrite ? ["Edit", "Write", "NotebookEdit"] : []),
      ...(input.agent.canRunCommands ? ["Bash"] : []),
    ];

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
        // Non-interactive runs have nothing attached to answer permission
        // prompts, so anything outside the configured capabilities must be
        // auto-denied instead of stalling the session waiting for approval.
        "--permission-prompts",
        "none",
        // Passed as a single "--flag=value" token: --allowedTools takes a
        // variadic list, so a separate argv element would swallow the
        // trailing prompt argument as an additional tool name.
        ...(allowedTools.length > 0
          ? [`--allowedTools=${allowedTools.join(" ")}`]
          : []),
        prompt,
      ],
      cwd: input.projectPath,
      env: environment,
    };
  },

  translateOutput: providerEvents,
  extractMessageText,
};
