import { afterEach, describe, expect, it, vi } from "vitest";

import type { StartWorkerInput } from "../contracts.js";

const mocks = vi.hoisted(() => ({
  getKnowledgeMcpServerConfig: vi.fn(),
}));

vi.mock("../../services/knowledge-mcp-client.js", () => ({
  getKnowledgeMcpServerConfig: mocks.getKnowledgeMcpServerConfig,
}));

const { claudeHarness } = await import("./claude.js");
const { codexHarness } = await import("./codex.js");

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

const environment: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

afterEach(() => {
  mocks.getKnowledgeMcpServerConfig.mockReset();
});

describe("worker read-only knowledge retrieval (Slice 8)", () => {
  it("grants Claude the two approved read-only knowledge tools when configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue({
      command: "knowledge-vault-mcp",
      args: [],
      env: { KNOWLEDGE_VAULT_ROOT: "/vault" },
    });

    const invocation = claudeHarness.createInvocation(baseInput, "prompt text", environment);

    const mcpConfigIndex = invocation.args.indexOf("--mcp-config");
    expect(mcpConfigIndex).toBeGreaterThan(-1);

    const mcpConfig = JSON.parse(invocation.args[mcpConfigIndex + 1] as string);
    expect(mcpConfig).toEqual({
      mcpServers: {
        knowledge_vault: {
          type: "stdio",
          command: "knowledge-vault-mcp",
          args: [],
          env: { KNOWLEDGE_VAULT_ROOT: "/vault" },
        },
      },
    });

    expect(invocation.args).toContain("--strict-mcp-config");

    const allowedTools = invocation.args.find((arg) => arg.startsWith("--allowedTools="));
    expect(allowedTools).toContain("mcp__knowledge_vault__search_knowledge");
    expect(allowedTools).toContain("mcp__knowledge_vault__get_note_section");

    // No write/command tool leaked in for a read-only-capability agent.
    expect(allowedTools).not.toContain("Edit");
    expect(allowedTools).not.toContain("Bash");

    expect(invocation.args.at(-1)).toBe("prompt text");
  });

  it("never adds vault write tools for Claude, only the two approved read tools", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue({
      command: "knowledge-vault-mcp",
      args: [],
      env: {},
    });

    const invocation = claudeHarness.createInvocation(
      { ...baseInput, agent: { ...baseInput.agent, canWrite: true, canRunCommands: true } },
      "prompt text",
      environment,
    );

    const allowedTools = invocation.args.find((arg) => arg.startsWith("--allowedTools="));
    expect(allowedTools?.replace("--allowedTools=", "").split(" ")).toEqual(
      expect.arrayContaining([
        "Edit",
        "Write",
        "NotebookEdit",
        "Bash",
        "mcp__knowledge_vault__search_knowledge",
        "mcp__knowledge_vault__get_note_section",
      ]),
    );
  });

  it("grants no knowledge MCP tools to Claude when the knowledge MCP is not configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue(null);

    const invocation = claudeHarness.createInvocation(baseInput, "prompt text", environment);

    expect(invocation.args).not.toContain("--mcp-config");
    expect(invocation.args).not.toContain("--strict-mcp-config");
    // Zero-capability agent with no knowledge server: no --allowedTools flag at all,
    // preserving Claude's own default tool policy exactly as before Slice 8.
    expect(invocation.args.some((arg) => arg.startsWith("--allowedTools="))).toBe(false);
  });

  it("grants Codex the knowledge MCP server via config overrides when configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue({
      command: "knowledge-vault-mcp",
      args: [],
      env: { KNOWLEDGE_VAULT_ROOT: "/vault" },
    });

    const invocation = codexHarness.createInvocation(baseInput, "prompt text", environment);

    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "-c",
        'mcp_servers.knowledge_vault.command="knowledge-vault-mcp"',
        'mcp_servers.knowledge_vault.env={ "KNOWLEDGE_VAULT_ROOT" = "/vault" }',
      ]),
    );

    expect(invocation.args.at(-1)).toBe("prompt text");
  });

  it("adds no knowledge MCP overrides for Codex when not configured", () => {
    mocks.getKnowledgeMcpServerConfig.mockReturnValue(null);

    const invocation = codexHarness.createInvocation(baseInput, "prompt text", environment);

    expect(invocation.args.join(" ")).not.toContain("mcp_servers");
  });
});
