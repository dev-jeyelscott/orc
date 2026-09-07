import type {
  RuntimeSession,
  StartWorkerInput,
} from "./contracts.js";

import {
  getHarnessAdapter,
} from "./harnesses/registry.js";

import {
  nodePtyFactory,
} from "./pty.js";

import {
  InMemoryRuntimeSession,
} from "./session.js";

export * from "./contracts.js";

export {
  composeHandoffNote,
  composeInitialInstruction,
  composeKnowledgeContext,
  composeRepairInstruction,
  RESULT_BLOCK_END,
  RESULT_BLOCK_START,
} from "./prompt.js";

export {
  getHarnessAdapter,
} from "./harnesses/registry.js";

/**
 * Starts one configured worker through the generic harness adapter and PTY runtime.
 */
export function startWorker(
  input:
    StartWorkerInput,
): RuntimeSession {
  return InMemoryRuntimeSession.start(
    input,
    getHarnessAdapter(
      input.agent.harness,
    ),
    nodePtyFactory,
  );
}

/**
 * Starts a one-shot harness session with caller-owned prompt and contract, used by the supervisor and repair flow.
 */
export function startHarnessSession(
  input:
    StartWorkerInput,
  prompt:
    string,
): RuntimeSession {
  return InMemoryRuntimeSession.start(
    input,
    getHarnessAdapter(
      input.agent.harness,
    ),
    nodePtyFactory,
    prompt,
  );
}
