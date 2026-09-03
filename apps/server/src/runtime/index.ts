import type { RuntimeSession, StartWorkerInput } from "./contracts.js";
import { getHarnessAdapter } from "./harnesses/registry.js";
import { nodePtyFactory } from "./pty.js";
import { InMemoryRuntimeSession } from "./session.js";

export * from "./contracts.js";
export { composeInitialInstruction } from "./prompt.js";
export { getHarnessAdapter } from "./harnesses/registry.js";

export function startWorker(input: StartWorkerInput): RuntimeSession {
  return InMemoryRuntimeSession.start(input, getHarnessAdapter(input.agent.harness), nodePtyFactory);
}
