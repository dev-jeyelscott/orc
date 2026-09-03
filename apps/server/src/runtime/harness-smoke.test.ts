import { fileURLToPath } from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

import type { Harness } from "@orc/shared";

import {
  startWorker,
  type StartWorkerInput,
} from "./index.js";

const runSmoke = process.env.ORC_RUN_HARNESS_SMOKE === "true";

const projectPath = fileURLToPath(
  new URL(
    "../../../../",
    import.meta.url,
  ),
);

/** Creates a minimal real worker configuration for an authenticated local harness smoke run. */
function createSmokeInput(
  harness: Harness,
): StartWorkerInput {
  return {
    projectPath,
    agent: {
      harness,
      model: "default",
      reasoning: "low",
      systemPrompt: "Keep this smoke check minimal. Do not use tools unless required.",
      canWrite: false,
      canRunCommands: false,
      canCommit: false,
    },
    instruction: "Do not use tools. Complete the task immediately and use READY as the structured result summary.",
  };
}

/** Runs a real worker session and resolves with its captured PTY output after a clean exit. */
function runHarnessSmoke(
  harness: Harness,
): Promise<string> {
  const session = startWorker(
    createSmokeInput(harness),
  );

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let output = "";

      session.subscribe((event) => {
        if (event.type === "output") {
          output += event.data;
          return;
        }

        if (
          event.type === "diagnostic"
          && session.metadata.state === "failed"
        ) {
          reject(
            new Error(
              `${event.diagnostic.code}: ${event.diagnostic.message}`,
            ),
          );
          return;
        }

        if (event.type === "exit") {
          if (event.exitCode === 0) {
            resolve(output);
          } else {
            reject(
              new Error(
                `${harness} exited with code ${event.exitCode}`,
              ),
            );
          }
        }
      });
    },
  );
}

describe.skipIf(!runSmoke)(
  "local harness runtime smoke checks",
  () => {
    it(
      "runs an authenticated Codex session through startWorker",
      async () => {
        const output = await runHarnessSmoke("codex");

        expect(output).toContain("READY");
      },
      120_000,
    );

    it(
      "runs an authenticated Claude session through startWorker",
      async () => {
        const output = await runHarnessSmoke("claude");

        expect(output).toContain("READY");
      },
      120_000,
    );
  },
);
