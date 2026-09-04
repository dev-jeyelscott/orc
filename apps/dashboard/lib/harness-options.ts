import type {
  Harness,
  OrchestratorSettings,
} from "@orc/shared";

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

/**
 * Changes the Orchestrator harness and selects canonical provider defaults when supported.
 */
export function changeOrchestratorHarness(
  current:
    OrchestratorSettings,
  harness:
    Harness,
): OrchestratorSettings {
  const options =
    harnessOptions[
      harness
    ];

  const model =
    options.models.includes(
      "default",
    )
      ? "default"
      : options.models[0] ??
        current.model;

  const reasoning =
    options.reasoning.includes(
      "low",
    )
      ? "low"
      : options.reasoning[0] ??
        current.reasoning;

  return {
    ...current,
    harness,
    model,
    reasoning,
  };
}

/**
 * Prepends an unsupported persisted value so the operator can see it until choosing a supported option.
 */
export function includePersistedOption(
  options:
    readonly string[],
  persistedValue:
    string,
): string[] {
  if (
    options.includes(
      persistedValue,
    )
  ) {
    return [
      ...options,
    ];
  }

  return [
    persistedValue,
    ...options,
  ];
}
