import type { RuntimeSession, StartWorkerInput } from "./contracts.js";
import { getHarnessAdapter } from "./harnesses/registry.js";
import { nodePtyFactory } from "./pty.js";
import { InMemoryRuntimeSession } from "./session.js";

export * from "./contracts.js";
export { composeInitialInstruction, composeRepairInstruction, RESULT_BLOCK_START, RESULT_BLOCK_END } from "./prompt.js";
export { getHarnessAdapter } from "./harnesses/registry.js";

export function startWorker(input: StartWorkerInput): RuntimeSession {
  return InMemoryRuntimeSession.start(input, getHarnessAdapter(input.agent.harness), nodePtyFactory);
}

/** Starts a one-shot harness session with caller-owned prompt/contract (used by the supervisor). */
export function startHarnessSession(input: StartWorkerInput, prompt: string): RuntimeSession {
  return InMemoryRuntimeSession.start(input, getHarnessAdapter(input.agent.harness), nodePtyFactory, prompt);
}
