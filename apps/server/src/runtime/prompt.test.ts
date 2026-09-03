import { describe, expect, it } from "vitest";

import type { AgentResult } from "@orc/shared";

import type { StartWorkerInput } from "./contracts.js";
import {
  composeHandoffNote,
  composeInitialInstruction,
  composeRepairInstruction,
} from "./prompt.js";

const baseInput: StartWorkerInput = {
  projectPath: "/projects/example",
  agent: {
    harness: "codex",
    model: "default",
    reasoning: "high",
    systemPrompt: "Follow local conventions.",
    canWrite: false,
    canRunCommands: true,
    canCommit: false,
  },
  instruction: "Inspect the implementation.",
};

/** Creates a complete structured agent result with optional field overrides. */
function makeResult(
  overrides: Partial<AgentResult> = {},
): AgentResult {
  return {
    status: "changes_requested",
    summary: "Found a null pointer risk in the payment handler.",
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
    ...overrides,
  };
}

describe("composeInitialInstruction", () => {
  it("includes repository and capability restrictions", () => {
    const prompt = composeInitialInstruction(baseInput);

    expect(prompt).toContain(
      "Selected repository: /projects/example",
    );

    expect(prompt).toContain(
      "Strictly do not modify, create, or delete files.",
    );

    expect(prompt).toContain(
      "You may run commands needed to complete the task.",
    );

    expect(prompt).toContain(
      "Strictly do not create Git commits.",
    );
  });

  it("includes centralized safe-command guidance", () => {
    const prompt = composeInitialInstruction(baseInput);

    expect(prompt).toContain(
      "Stay inside the selected repository.",
    );

    expect(prompt).toContain(
      "Do not use sudo, privileged commands",
    );

    expect(prompt).toContain(
      "Avoid broad or destructive deletes",
    );

    expect(prompt).toContain(
      "Do not use destructive Git resets, force pushes",
    );

    expect(prompt).toContain(
      "Do not modify system packages or services",
    );

    expect(prompt).toContain(
      "Do not assume a runtime command sandbox or command firewall exists.",
    );
  });

  it("requires one final result block with no trailing content", () => {
    const prompt = composeInitialInstruction(baseInput);

    expect(prompt).toContain("emit exactly one JSON object");
    expect(prompt).toContain(
      "must be the final non-whitespace content of the message",
    );
    expect(prompt).toContain("Do not emit a second result block.");
  });
});

describe("composeHandoffNote", () => {
  it("carries the previous agent outcome and summary", () => {
    const note = composeHandoffNote(
      {
        name: "QA",
        role: "Reviewer",
      },
      makeResult(),
    );

    expect(note).toContain(
      "Handoff from QA (Reviewer):",
    );

    expect(note).toContain(
      "Previous outcome: changes_requested",
    );

    expect(note).toContain(
      "Previous summary: Found a null pointer risk in the payment handler.",
    );
  });

  it("preserves all meaningful structured QA context for a changes_requested handoff", () => {
    const note = composeHandoffNote(
      {
        name: "QA",
        role: "Reviewer",
      },
      makeResult({
        details: {
          severity: "high",
          owner: "builder",
        },
        findings: [
          "Missing null check on line 42",
          "No test for the empty-cart case",
        ],
        filesChanged: [
          "src/payment.ts",
        ],
        commandsRun: [
          "pnpm test",
          "pnpm typecheck",
        ],
        validation: {
          testsPassed: false,
        },
        commit: "abcdef1234567890",
      }),
    );

    expect(note).toContain(
      'Details: {"severity":"high","owner":"builder"}',
    );
    expect(note).toContain("Findings:");
    expect(note).toContain("- Missing null check on line 42");
    expect(note).toContain("- No test for the empty-cart case");
    expect(note).toContain("Files changed:");
    expect(note).toContain("- src/payment.ts");
    expect(note).toContain("Commands run:");
    expect(note).toContain("- pnpm test");
    expect(note).toContain("- pnpm typecheck");
    expect(note).toContain(
      'Validation: {"testsPassed":false}',
    );
    expect(note).toContain("Commit: abcdef1234567890");
  });

  it("omits empty handoff sections instead of printing them blank", () => {
    const note = composeHandoffNote(
      {
        name: "QA",
        role: "Reviewer",
      },
      makeResult(),
    );

    expect(note).not.toContain("Details:");
    expect(note).not.toContain("Findings:");
    expect(note).not.toContain("Files changed:");
    expect(note).not.toContain("Commands run:");
    expect(note).not.toContain("Validation:");
    expect(note).not.toContain("Commit:");
  });
});

describe("composeRepairInstruction", () => {
  it("makes repair result-only and explicitly side-effect free", () => {
    const prompt = composeRepairInstruction(
      "Implement the requested change.",
      "Previous malformed completion",
      ["files_changed: Unrecognized key"],
    );

    expect(prompt).toContain(
      "Your only job is to repair the previous structured completion result.",
    );
    expect(prompt).toContain("Do not execute or repeat the original task.");
    expect(prompt).toContain("Do not inspect the repository");
    expect(prompt).toContain("run terminal commands");
    expect(prompt).toContain("create Git commits");
    expect(prompt).toContain("Previous malformed completion");
    expect(prompt).toContain("files_changed: Unrecognized key");
    expect(prompt).toContain(
      "must be the final non-whitespace content",
    );
  });
});
