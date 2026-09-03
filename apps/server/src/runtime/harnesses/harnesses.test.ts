import { describe, expect, it } from "vitest";

import type { StartWorkerInput } from "../contracts.js";
import { composeInitialInstruction } from "../prompt.js";
import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";
import { getHarnessAdapter } from "./registry.js";

const baseInput: StartWorkerInput = {
  projectPath: "/projects/example",
  agent: {
    harness: "codex",
    model: "gpt-5",
    reasoning: "high",
    systemPrompt: "Follow local conventions.",
    canWrite: false,
    canRunCommands: true,
    canCommit: false,
  },
  instruction: "Implement the requested change.",
};

const environment: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  ORC_HARNESS_TEST: "enabled",
};

describe("harness adapters", () => {
  it("constructs a Codex invocation with model, reasoning, cwd, and environment", () => {
    const prompt = composeInitialInstruction(baseInput);

    const invocation = codexHarness.createInvocation(
      baseInput,
      prompt,
      environment,
    );

    expect(invocation).toEqual(
      expect.objectContaining({
        command: "codex",
        cwd: "/projects/example",
        env: environment,
      }),
    );

    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--json",
        "--model",
        "gpt-5",
        "model_reasoning_effort=high",
      ]),
    );

    expect(invocation.args.at(-1)).toBe(prompt);
  });

  it("constructs a Claude invocation with model, effort, cwd, and environment", () => {
    const input = {
      ...baseInput,
      agent: {
        ...baseInput.agent,
        harness: "claude",
        model: "sonnet",
        reasoning: "medium",
      },
    } as StartWorkerInput;

    const invocation = claudeHarness.createInvocation(
      input,
      composeInitialInstruction(input),
      environment,
    );

    expect(invocation).toEqual(
      expect.objectContaining({
        command: "claude",
        cwd: "/projects/example",
        env: environment,
      }),
    );

    expect(invocation.args).toEqual(
      expect.arrayContaining([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "sonnet",
        "--effort",
        "medium",
      ]),
    );
  });

  it("omits explicit model arguments for the default model sentinel", () => {
    const codexInput: StartWorkerInput = {
      ...baseInput,
      agent: {
        ...baseInput.agent,
        model: "default",
      },
    };

    const claudeInput: StartWorkerInput = {
      ...baseInput,
      agent: {
        ...baseInput.agent,
        harness: "claude",
        model: "default",
        reasoning: "medium",
      },
    };

    const codexInvocation = codexHarness.createInvocation(
      codexInput,
      composeInitialInstruction(codexInput),
      environment,
    );

    const claudeInvocation = claudeHarness.createInvocation(
      claudeInput,
      composeInitialInstruction(claudeInput),
      environment,
    );

    expect(codexInvocation.args).not.toContain("--model");
    expect(claudeInvocation.args).not.toContain("--model");
  });

  it("normalizes provider JSON into generic provider and usage events", () => {
    const events = claudeHarness.translateOutput(
      '{"type":"result","usage":{"input_tokens":2}}\n',
    );

    expect(events).toEqual([
      {
        type: "provider",
        provider: "claude",
        event: {
          type: "result",
          usage: {
            input_tokens: 2,
          },
        },
      },
      {
        type: "usage",
        usage: {
          input_tokens: 2,
        },
      },
    ]);

    expect(getHarnessAdapter("codex")).toBe(codexHarness);
  });

  it("extracts only completed/final assistant content for contract validation", () => {
    expect(
      claudeHarness.extractMessageText?.({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Intermediate assistant content",
            },
          ],
        },
      }),
    ).toBeUndefined();

    expect(
      claudeHarness.extractMessageText?.({
        type: "result",
        result: "Claude final completion",
      }),
    ).toBe("Claude final completion");

    expect(
      codexHarness.extractMessageText?.({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Codex completed message",
        },
      }),
    ).toBe("Codex completed message");
  });

  it("fails explicitly for unsupported Claude effort configuration", () => {
    expect(() => {
      claudeHarness.createInvocation(
        {
          ...baseInput,
          agent: {
            ...baseInput.agent,
            harness: "claude",
            reasoning: "none",
          },
        },
        "prompt",
        environment,
      );
    }).toThrow("Unsupported Claude effort level");
  });
});
