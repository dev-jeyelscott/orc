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

export const claudeHarness: HarnessAdapter = {
  harness: "claude",
  createInvocation(input: StartWorkerInput, prompt: string) {
    if (!CLAUDE_EFFORT_LEVELS.has(input.agent.reasoning)) {
      throw new Error(`Unsupported Claude effort level: ${input.agent.reasoning}`);
    }
    return {
      command: "claude",
      args: ["--print", "--output-format", "stream-json", "--model", input.agent.model, "--effort", input.agent.reasoning, prompt],
      cwd: input.projectPath,
    };
  },
  translateOutput: providerEvents,
};
