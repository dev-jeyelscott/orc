import { describe, expect, it } from "vitest";

import { agentResultSchema } from "./agent-result.js";
import {
  MAX_KNOWLEDGE_REQUIREMENTS,
  MAX_KNOWLEDGE_REQUIREMENT_REASON_CHARS,
} from "./knowledge-requirement.js";

function completedResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    summary: "Completed planning for the requested work.",
    ...overrides,
  };
}

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    categorySlug: "ui-ux-guidelines",
    query: "forms validation error states inputs accessibility",
    reason: "The implementation adds a multi-step user form.",
    required: true,
    ...overrides,
  };
}

describe("AgentResult knowledgeRequirements", () => {
  it("preserves compatibility when knowledgeRequirements is omitted", () => {
    const result = agentResultSchema.parse(completedResult());
    expect(result.knowledgeRequirements).toBeUndefined();
  });

  it("accepts a bounded set of explicit requirements and defaults required to true", () => {
    const result = agentResultSchema.parse(
      completedResult({
        knowledgeRequirements: [requirement(), requirement({ categorySlug: "engineering-guidelines", required: undefined })],
      }),
    );

    expect(result.knowledgeRequirements).toHaveLength(2);
    expect(result.knowledgeRequirements?.[1]?.required).toBe(true);
  });

  it("rejects too many requirements", () => {
    const requirements = Array.from({ length: MAX_KNOWLEDGE_REQUIREMENTS + 1 }, (_, index) =>
      requirement({ categorySlug: `category-${index}` }));

    expect(
      agentResultSchema.safeParse(completedResult({ knowledgeRequirements: requirements })).success,
    ).toBe(false);
  });

  it("rejects a non-kebab-case category slug", () => {
    expect(
      agentResultSchema.safeParse(
        completedResult({ knowledgeRequirements: [requirement({ categorySlug: "UI/UX" })] }),
      ).success,
    ).toBe(false);
  });

  it("rejects an empty query or reason", () => {
    expect(
      agentResultSchema.safeParse(
        completedResult({ knowledgeRequirements: [requirement({ query: "" })] }),
      ).success,
    ).toBe(false);

    expect(
      agentResultSchema.safeParse(
        completedResult({ knowledgeRequirements: [requirement({ reason: "" })] }),
      ).success,
    ).toBe(false);
  });

  it("rejects an oversized reason", () => {
    expect(
      agentResultSchema.safeParse(
        completedResult({
          knowledgeRequirements: [
            requirement({ reason: "x".repeat(MAX_KNOWLEDGE_REQUIREMENT_REASON_CHARS + 1) }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unknown field, keeping the contract generic and closed", () => {
    expect(
      agentResultSchema.safeParse(
        completedResult({
          knowledgeRequirements: [requirement({ role: "architect" })],
        }),
      ).success,
    ).toBe(false);
  });
});
