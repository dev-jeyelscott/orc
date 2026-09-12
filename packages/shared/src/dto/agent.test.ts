import { describe, expect, it } from "vitest";

import { createAgentSchema } from "./agent.js";

const baseAgent = {
  departmentId: "00000000-0000-4000-7000-000000000001",
  teamId: "00000000-0000-4000-9000-000000000001",
  slug: "qa",
  name: "QA",
  layer: 3,
  executionOrder: 1,
  enabled: true,
};

describe("createAgentSchema", () => {
  it("accepts an Agent with only identity and Department fields", () => {
    const parsed = createAgentSchema.parse(baseAgent);

    expect(parsed.departmentId).toBe(baseAgent.departmentId);
    expect(parsed.modelOverride).toBeUndefined();
    expect(parsed.reasoningOverride).toBeUndefined();
    expect(parsed.additionalPrompt).toBe("");
  });

  it("accepts explicit model and reasoning overrides", () => {
    const parsed = createAgentSchema.parse({
      ...baseAgent,
      modelOverride: "claude-sonnet-5",
      reasoningOverride: "high",
      additionalPrompt: "Focus on the payments module.",
    });

    expect(parsed.modelOverride).toBe("claude-sonnet-5");
    expect(parsed.reasoningOverride).toBe("high");
    expect(parsed.additionalPrompt).toBe(
      "Focus on the payments module.",
    );
  });

  it("rejects Department-owned fields such as role or harness", () => {
    const parsed = createAgentSchema.safeParse({
      ...baseAgent,
      role: "QA",
      harness: "codex",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("role");
      expect(parsed.data).not.toHaveProperty("harness");
    }
  });

  it("requires a Department", () => {
    const { departmentId: _departmentId, ...withoutDepartment } = baseAgent;

    expect(
      createAgentSchema.safeParse(withoutDepartment).success,
    ).toBe(false);
  });
});
