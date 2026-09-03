import { describe, expect, it } from "vitest";

import type { AgentResult } from "@orc/shared";

import { composeHandoffNote } from "./prompt.js";

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
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

describe("composeHandoffNote", () => {
  it("carries the previous agent's outcome and summary", () => {
    const note = composeHandoffNote({ name: "QA", role: "Reviewer" }, makeResult());

    expect(note).toContain("Handoff from QA (Reviewer):");
    expect(note).toContain("Previous outcome: changes_requested");
    expect(note).toContain("Previous summary: Found a null pointer risk in the payment handler.");
  });

  it("includes findings, files changed, and validation when present", () => {
    const note = composeHandoffNote(
      { name: "QA", role: "Reviewer" },
      makeResult({
        findings: ["Missing null check on line 42", "No test for the empty-cart case"],
        filesChanged: ["src/payment.ts"],
        validation: { testsPassed: false },
      }),
    );

    expect(note).toContain("Findings:");
    expect(note).toContain("- Missing null check on line 42");
    expect(note).toContain("- No test for the empty-cart case");
    expect(note).toContain("Files changed: src/payment.ts");
    expect(note).toContain('Validation: {"testsPassed":false}');
  });

  it("omits empty sections instead of printing them blank", () => {
    const note = composeHandoffNote({ name: "QA", role: "Reviewer" }, makeResult());

    expect(note).not.toContain("Findings:");
    expect(note).not.toContain("Files changed:");
    expect(note).not.toContain("Validation:");
  });
});
