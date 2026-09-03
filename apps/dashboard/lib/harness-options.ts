import type { Harness } from "@orc/shared";

export const harnessOptions: Record<Harness, { models: string[]; reasoning: string[] }> = {
  codex: {
    models: ["default", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
    reasoning: ["none", "low", "medium", "high", "xhigh", "max"],
  },
  claude: {
    models: [
      "default",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ],
    reasoning: ["low", "medium", "high"],
  },
};
