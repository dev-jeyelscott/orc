import { describe, expect, it } from "vitest";

import type { StartWorkerInput } from "../contracts.js";
import { composeInitialInstruction } from "../prompt.js";
import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";
import { getHarnessAdapter } from "./registry.js";

const baseInput: StartWorkerInput = {
  projectPath: "/projects/example",
  agent: { harness: "codex", model: "gpt-5", reasoning: "high", systemPrompt: "Follow local conventions.", canWrite: false, canRunCommands: true, canCommit: false },
  instruction: "Implement the requested change.",
};

describe("harness adapters", () => {
  it("constructs a Codex invocation with model and reasoning configuration", () => {
    const prompt = composeInitialInstruction(baseInput);
    const invocation = codexHarness.createInvocation(baseInput, prompt);
    expect(invocation).toEqual(expect.objectContaining({ command: "codex", cwd: "/projects/example" }));
    expect(invocation.args).toEqual(expect.arrayContaining(["exec", "--json", "--model", "gpt-5", "model_reasoning_effort=high"]));
    expect(invocation.args.at(-1)).toBe(prompt);
  });

  it("constructs a Claude streaming invocation with model and effort", () => {
    const input = { ...baseInput, agent: { ...baseInput.agent, harness: "claude", model: "sonnet", reasoning: "medium" } } as StartWorkerInput;
    const invocation = claudeHarness.createInvocation(input, composeInitialInstruction(input));
    expect(invocation).toEqual(expect.objectContaining({ command: "claude", cwd: "/projects/example" }));
    expect(invocation.args).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json", "--verbose", "--model", "sonnet", "--effort", "medium"]));
  });

  it("composes capability guidance without provider permission modes", () => {
    const prompt = composeInitialInstruction(baseInput);
    expect(prompt).toContain("Selected repository: /projects/example");
    expect(prompt).toContain("Strictly do not modify, create, or delete files.");
    expect(prompt).toContain("You may run commands needed to complete the task.");
    expect(prompt).toContain("Strictly do not create Git commits.");
  });

  it("normalizes provider JSON into generic provider and usage events", () => {
    const events = claudeHarness.translateOutput('{"type":"result","usage":{"input_tokens":2}}\n');
    expect(events).toEqual([{ type: "provider", provider: "claude", event: { type: "result", usage: { input_tokens: 2 } } }, { type: "usage", usage: { input_tokens: 2 } }]);
    expect(getHarnessAdapter("codex")).toBe(codexHarness);
  });

  it("fails explicitly for unsupported effort configuration", () => {
    expect(() => claudeHarness.createInvocation({ ...baseInput, agent: { ...baseInput.agent, harness: "claude", reasoning: "none" } }, "prompt")).toThrow("Unsupported Claude effort level");
  });
});
