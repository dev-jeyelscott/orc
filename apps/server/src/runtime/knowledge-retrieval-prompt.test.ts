import { afterEach, describe, expect, it, vi } from "vitest";

import type { StartWorkerInput } from "./contracts.js";

const mocks = vi.hoisted(() => ({
  getKnowledgeMcpServerConfig: vi.fn(),
}));

vi.mock("../services/knowledge-mcp-client.js", () => ({
  getKnowledgeMcpServerConfig: mocks.getKnowledgeMcpServerConfig,
}));

const { composeInitialInstruction } = await import("./prompt.js");

const baseInput: StartWorkerInput = {
  projectPath: "/projects/example",
  agent: {
    harness: "codex",
    model: "default",
    reasoning: "high",
    systemPrompt: "Follow local conventions.",
    canWrite: false,
    canRunCommands: false,
    canCommit: false,
  },
  instruction: "Implement the requested change.",
};

afterEach(() => {
  mocks.getKnowledgeMcpServerConfig.mockReset();
});

describe("composeInitialInstruction knowledge retrieval guidance", () => {
  it("includes retrieval guidance when the knowledge MCP is configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue({
      command: "knowledge-vault-mcp",
      args: [],
      env: {},
    });

    const instruction = composeInitialInstruction(baseInput);

    expect(instruction).toContain("Durable knowledge retrieval guidance");
    expect(instruction).toContain("read-only durable knowledge retrieval tool");
    expect(instruction).toContain("discovery hint, not a restriction");
    expect(instruction).toContain("project-specific design system or guidance conflicts");
  });

  it("omits retrieval guidance when the knowledge MCP is not configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue(null);

    const instruction = composeInitialInstruction(baseInput);

    expect(instruction).not.toContain("Durable knowledge retrieval guidance");
  });
});
