import type {
  Harness,
  RetryRun,
} from "@orc/shared";

import {
  harnessOptions,
} from "@/lib/harness-options";

export interface RetryExecutionConfiguration {
  harness: Harness;
  model: string;
  reasoning: string;
}

/** Returns only settings changed from the failed execution for a one-execution retry. */
export function retryExecutionOverride(
  configuration: RetryExecutionConfiguration,
  draft: RetryExecutionConfiguration,
): RetryRun {
  return {
    ...(draft.harness !== configuration.harness
      ? { harness: draft.harness }
      : {}),
    ...(draft.model !== configuration.model
      ? { model: draft.model }
      : {}),
    ...(draft.reasoning !== configuration.reasoning
      ? { reasoning: draft.reasoning }
      : {}),
  };
}

/** Changes harnesses while selecting that provider's safe default model and reasoning level. */
export function retryConfigurationForHarness(
  current: RetryExecutionConfiguration,
  harness: Harness,
): RetryExecutionConfiguration {
  const options = harnessOptions[harness];

  return {
    harness,
    model: options.models.includes("default")
      ? "default"
      : options.models[0] ?? current.model,
    reasoning: options.reasoning.includes("low")
      ? "low"
      : options.reasoning[0] ?? current.reasoning,
  };
}
