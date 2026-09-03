import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const runSmoke = process.env.ORC_RUN_HARNESS_SMOKE === "true";

describe.skipIf(!runSmoke)("local harness CLI smoke checks", () => {
  it("runs an authenticated Codex one-shot session", () => {
    const output = execFileSync("codex", ["exec", "--ephemeral", "--sandbox", "read-only", "Reply with exactly READY. Do not use tools."], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(output).toContain("READY");
  });

  it("runs an authenticated Claude one-shot session", () => {
    const output = execFileSync("claude", ["--print", "--no-session-persistence", "Reply with exactly READY. Do not use tools."], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(output).toContain("READY");
  });
});
