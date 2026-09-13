import { describe, expect, it } from "vitest";

import type { AgentResult } from "@orc/shared";

import { composeHandoffNote, composeKnowledgeRequirementNote } from "./prompt.js";

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    status: "completed",
    summary: "Planned the multi-step form implementation.",
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit: null,
    ...overrides,
  };
}

describe("composeKnowledgeRequirementNote", () => {
  it("returns null for no requirements", () => {
    expect(composeKnowledgeRequirementNote([])).toBeNull();
  });

  it("formats each resolved requirement with category, query, reason, and required state", () => {
    const note = composeKnowledgeRequirementNote([
      {
        categorySlug: "ui-ux-guidelines",
        query: "forms validation error states",
        reason: "The implementation adds a multi-step user form.",
        required: true,
        category: { slug: "ui-ux-guidelines", name: "UI/UX Guidelines" },
      },
      {
        categorySlug: "engineering-guidelines",
        query: "react forms component architecture",
        reason: "Frontend implementation must follow established patterns.",
        required: false,
        category: { slug: "engineering-guidelines", name: "Engineering Guidelines" },
      },
    ]);

    expect(note).toContain("Required knowledge:");
    expect(note).toContain("UI/UX Guidelines (ui-ux-guidelines)");
    expect(note).toContain("Requirement 1 (required)");
    expect(note).toContain("Requirement 2 (optional)");
    expect(note).toContain("forms validation error states");
  });
});

describe("composeHandoffNote knowledgeRequirements audit trail", () => {
  it("omits the declared-requirements section when none were emitted", () => {
    const note = composeHandoffNote({ name: "Architect", role: "Architect" }, makeResult());
    expect(note).not.toContain("Declared knowledge requirements:");
  });

  it("records declared requirements for audit even before resolution", () => {
    const note = composeHandoffNote(
      { name: "Architect", role: "Architect" },
      makeResult({
        knowledgeRequirements: [
          {
            categorySlug: "ui-ux-guidelines",
            query: "forms validation error states",
            reason: "The implementation adds a multi-step user form.",
            required: true,
          },
        ],
      }),
    );

    expect(note).toContain("Declared knowledge requirements:");
    expect(note).toContain("ui-ux-guidelines (required): forms validation error states");
  });
});
