import { describe, expect, it } from "vitest";

import { agentResultSchema } from "./agent-result.js";

describe("agentResultSchema", () => {
  it("accepts a fully populated result payload", () => {
    const payload = {
      status: "completed",
      summary: "Implemented the requested change.",
      details: { note: "extra context" },
      findings: ["No issues found"],
      filesChanged: ["apps/server/src/index.ts"],
      commandsRun: ["pnpm test"],
      validation: { tests: "pass" },
      commit: "abcdef1",
    };

    const result = agentResultSchema.parse(payload);

    expect(result).toEqual(payload);
  });

  it("rejects unknown status values", () => {
    const result = agentResultSchema.safeParse({
      status: "done",
      summary: "Finished.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing or empty summary", () => {
    expect(
      agentResultSchema.safeParse({
        status: "completed",
      }).success,
    ).toBe(false);

    expect(
      agentResultSchema.safeParse({
        status: "completed",
        summary: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown or misspelled contract fields", () => {
    const result = agentResultSchema.safeParse({
      status: "completed",
      summary: "Finished.",
      files_changed: ["src/index.ts"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-hash commit metadata", () => {
    expect(
      agentResultSchema.safeParse({
        status: "completed",
        summary: "Finished.",
        commit: "not-a-commit",
      }).success,
    ).toBe(false);

    expect(
      agentResultSchema.safeParse({
        status: "completed",
        summary: "Finished.",
        commit: "",
      }).success,
    ).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const result = agentResultSchema.parse({
      status: "blocked",
      summary: "Needs operator input.",
    });

    expect(result).toEqual({
      status: "blocked",
      summary: "Needs operator input.",
      details: {},
      findings: [],
      filesChanged: [],
      commandsRun: [],
      validation: {},
      commit: null,
    });
  });
});
