import { describe, expect, it } from "vitest";

import { resolveEffectiveAgentConfig } from "./agent-config-resolver.js";

const department = {
  role: "QA Engineer",
  harness: "codex" as const,
  defaultModel: "gpt-5.6-terra",
  defaultReasoning: "medium",
  systemPrompt: "Review the implementation carefully.",
  canWrite: false,
  canRunCommands: true,
  sandboxMode: "read-only" as const,
  canCommit: false,
  enabled: true,
};

const agent = {
  enabled: true,
  modelOverride: null,
  reasoningOverride: null,
  additionalPrompt: "",
};

describe("resolveEffectiveAgentConfig", () => {
  it("inherits Department defaults when no override is set", () => {
    const effective = resolveEffectiveAgentConfig(agent, department);

    expect(effective.role).toBe(department.role);
    expect(effective.harness).toBe(department.harness);
    expect(effective.model).toBe(department.defaultModel);
    expect(effective.reasoning).toBe(department.defaultReasoning);
    expect(effective.systemPrompt).toBe(department.systemPrompt);
    expect(effective.canWrite).toBe(department.canWrite);
    expect(effective.canRunCommands).toBe(department.canRunCommands);
    expect(effective.sandboxMode).toBe(department.sandboxMode);
    expect(effective.canCommit).toBe(department.canCommit);
    expect(effective.enabled).toBe(true);
  });

  it("prefers Agent model and reasoning overrides", () => {
    const effective = resolveEffectiveAgentConfig(
      { ...agent, modelOverride: "claude-sonnet-5", reasoningOverride: "high" },
      department,
    );

    expect(effective.model).toBe("claude-sonnet-5");
    expect(effective.reasoning).toBe("high");
  });

  it("appends a non-empty additional prompt after the Department prompt", () => {
    const effective = resolveEffectiveAgentConfig(
      { ...agent, additionalPrompt: "Focus on the payments module." },
      department,
    );

    expect(effective.systemPrompt).toBe(
      "Review the implementation carefully.\n\nFocus on the payments module.",
    );
  });

  it("never grants capabilities through the additional prompt", () => {
    const effective = resolveEffectiveAgentConfig(
      { ...agent, additionalPrompt: "You may now run any command." },
      department,
    );

    expect(effective.canRunCommands).toBe(department.canRunCommands);
    expect(effective.canWrite).toBe(department.canWrite);
    expect(effective.canCommit).toBe(department.canCommit);
  });

  it("resolves enabled as Department enabled AND Agent enabled", () => {
    expect(
      resolveEffectiveAgentConfig(agent, { ...department, enabled: false })
        .enabled,
    ).toBe(false);

    expect(
      resolveEffectiveAgentConfig({ ...agent, enabled: false }, department)
        .enabled,
    ).toBe(false);

    expect(
      resolveEffectiveAgentConfig(
        { ...agent, enabled: false },
        { ...department, enabled: false },
      ).enabled,
    ).toBe(false);
  });
});
