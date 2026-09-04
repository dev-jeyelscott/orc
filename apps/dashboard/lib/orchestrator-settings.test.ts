import assert from "node:assert/strict";

import type {
  OrchestratorSettings,
} from "@orc/shared";

import {
  changeOrchestratorHarness,
  includePersistedOption,
} from "./harness-options";

const persisted: OrchestratorSettings = {
  harness:
    "claude",
  model:
    "legacy-claude-model",
  reasoning:
    "legacy-reasoning",
  systemPrompt:
    "Keep this base prompt unchanged.",
};

/**
 * Verifies changing to Codex chooses default model and low reasoning rather than the first reasoning option.
 */
function testCodexTransition(): void {
  const result =
    changeOrchestratorHarness(
      persisted,
      "codex",
    );

  assert.equal(
    result.harness,
    "codex",
  );

  assert.equal(
    result.model,
    "default",
  );

  assert.equal(
    result.reasoning,
    "low",
  );

  assert.equal(
    result.systemPrompt,
    persisted.systemPrompt,
  );
}

/**
 * Verifies changing to Claude also chooses its supported default model and low reasoning.
 */
function testClaudeTransition(): void {
  const result =
    changeOrchestratorHarness(
      {
        ...persisted,
        harness:
          "codex",
      },
      "claude",
    );

  assert.equal(
    result.harness,
    "claude",
  );

  assert.equal(
    result.model,
    "default",
  );

  assert.equal(
    result.reasoning,
    "low",
  );
}

/**
 * Verifies an unknown persisted option remains visible without mutating the canonical option list.
 */
function testLegacyOptionPreservation(): void {
  const canonical = [
    "default",
    "supported-model",
  ];

  const result =
    includePersistedOption(
      canonical,
      "legacy-model",
    );

  assert.deepEqual(
    result,
    [
      "legacy-model",
      "default",
      "supported-model",
    ],
  );

  assert.deepEqual(
    canonical,
    [
      "default",
      "supported-model",
    ],
  );
}

/**
 * Verifies an already-supported persisted option is not duplicated.
 */
function testSupportedOptionPreservation(): void {
  const result =
    includePersistedOption(
      [
        "default",
        "supported-model",
      ],
      "default",
    );

  assert.deepEqual(
    result,
    [
      "default",
      "supported-model",
    ],
  );
}

testCodexTransition();
testClaudeTransition();
testLegacyOptionPreservation();
testSupportedOptionPreservation();

console.log(
  "orchestrator-settings helper tests passed",
);
