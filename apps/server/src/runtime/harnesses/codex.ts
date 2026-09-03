import type { HarnessAdapter, StartWorkerInput, UnsequencedRuntimeEvent } from "../contracts.js";

const CODEX_REASONING_LEVELS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra"]);

function providerEvents(data: string): UnsequencedRuntimeEvent[] {
  return data.split(/\r?\n/).flatMap((line) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event === null || Array.isArray(event)) return [];
      const translated: UnsequencedRuntimeEvent[] = [{ type: "provider", provider: "codex", event }];
      if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) translated.push({ type: "usage", usage: event.usage as Record<string, unknown> });
      return translated;
    } catch {
      return [];
    }
  });
}

export const codexHarness: HarnessAdapter = {
  harness: "codex",
  createInvocation(input: StartWorkerInput, prompt: string) {
    if (!CODEX_REASONING_LEVELS.has(input.agent.reasoning)) {
      throw new Error(`Unsupported Codex reasoning level: ${input.agent.reasoning}`);
    }
    return {
      command: "codex",
      args: ["exec", "--json", "--model", input.agent.model, "--config", `model_reasoning_effort=${input.agent.reasoning}`, prompt],
      cwd: input.projectPath,
    };
  },
  translateOutput: providerEvents,
};
