import { describe, expect, it } from "vitest";

import { createAgentSchema } from "./agent.js";

const baseAgent = {
  teamId: "00000000-0000-4000-9000-000000000001",
  slug: "qa",
  name: "QA",
  role: "QA",
  description: "Reviews completed work.",
  layer: 3,
  executionOrder: 1,
  harness: "codex",
  model: "default",
  reasoning: "high",
  systemPrompt: "Review the implementation.",
  enabled: true,
  canWrite: false,
  canRunCommands: true,
  canCommit: false,
};

describe("createAgentSchema", () => {
  it("accepts the configured Codex sandbox mode", () => {
    expect(
      createAgentSchema.parse({
        ...baseAgent,
        sandboxMode: "danger-full-access",
      }).sandboxMode,
    ).toBe("danger-full-access");
  });

  it("keeps the sandbox setting optional for existing agents", () => {
    expect(
      createAgentSchema.parse(baseAgent).sandboxMode,
    ).toBeUndefined();
  });
});
