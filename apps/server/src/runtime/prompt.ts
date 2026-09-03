import type { StartWorkerInput } from "./contracts.js";

export function composeInitialInstruction(input: StartWorkerInput): string {
  const { agent, instruction, projectPath } = input;
  const capabilityGuidance = [
    agent.canWrite ? "You may modify files when the task requires it." : "Do not modify, create, or delete files.",
    agent.canRunCommands ? "You may run commands needed to complete the task." : "Do not run terminal commands.",
    agent.canCommit ? "You may create Git commits only when the task explicitly asks for one." : "Do not create Git commits.",
  ].join(" ");

  return [
    "You are a configured engineering worker operating directly in the selected repository.",
    `Selected repository: ${projectPath}`,
    "",
    "System instructions:",
    agent.systemPrompt,
    "",
    "Task instruction:",
    instruction,
    "",
    "Capability guidance (prompt-enforced):",
    capabilityGuidance,
  ].join("\n");
}
