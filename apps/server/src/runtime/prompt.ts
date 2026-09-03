import type { AgentResult } from "@orc/shared";

import type { StartWorkerInput } from "./contracts.js";

export const RESULT_BLOCK_START = "<orc-result>";
export const RESULT_BLOCK_END = "</orc-result>";

const RESULT_CONTRACT = [
  "Structured completion contract:",
  `As the very last content of your final message, emit exactly one JSON object wrapped in ${RESULT_BLOCK_START} and ${RESULT_BLOCK_END}. The closing ${RESULT_BLOCK_END} tag must be the final non-whitespace content of the message. The JSON object must match this shape:`,
  '{"status":"completed"|"approved"|"changes_requested"|"blocked"|"failed","summary":"string","details":{},"findings":["string"],"filesChanged":["string"],"commandsRun":["string"],"validation":{},"commit":"hex Git commit hash or null"}',
  "Field notes: `summary` is required and must be non-empty. `details`, `findings`, `filesChanged`, `commandsRun`, and `validation` may be empty but should be present as their respective empty value if you have nothing to report. `commit` must be a Git commit hash attributable to this logical execution, or null if no commit was created.",
  `Do not include code fences or commentary inside ${RESULT_BLOCK_START} and ${RESULT_BLOCK_END}. Do not emit a second result block.`,
].join("\n");

const SAFE_COMMAND_GUIDANCE = [
  "Stay inside the selected repository. Do not intentionally target unrelated files or directories outside it.",
  "Do not use sudo, privileged commands, or commands intended to alter machine-level security or permissions.",
  "Avoid broad or destructive deletes, filesystem formatting, disk operations, and destructive system changes.",
  "Do not use destructive Git resets, force pushes, or other force operations that can discard unrelated work or history.",
  "Do not delete unrelated project files or directories.",
  "Do not modify system packages or services unless the task explicitly requires it and the user has approved it.",
  "When command execution is permitted, prefer project-scoped dependency installation, tests, linting, type checking, builds, project scripts, and safe Git inspection.",
  "These instructions are prompt-enforced guidance. Do not assume a runtime command sandbox or command firewall exists.",
].join("\n");

/** Composes the complete initial worker instruction from task, capabilities, safety, and result contract. */
export function composeInitialInstruction(
  input: StartWorkerInput,
): string {
  const {
    agent,
    instruction,
    projectPath,
  } = input;

  const capabilityGuidance = [
    agent.canWrite
      ? "You may modify files when the task requires it."
      : "Strictly do not modify, create, or delete files.",
    agent.canRunCommands
      ? "You may run commands needed to complete the task."
      : "Strictly do not run terminal commands.",
    agent.canCommit
      ? "You may create Git commits only when the task explicitly asks for one. Report the commit hash in the result's `commit` field if you created one, otherwise leave `commit` null."
      : "Strictly do not create Git commits. Leave the result's `commit` field null.",
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
    "",
    "Safe command guidance (prompt-enforced):",
    SAFE_COMMAND_GUIDANCE,
    "",
    RESULT_CONTRACT,
  ].join("\n");
}

/** Composes structured prior-agent context for the next configured workflow execution. */
export function composeHandoffNote(
  source: {
    name: string;
    role: string;
  },
  result: AgentResult,
): string {
  const lines = [
    `Handoff from ${source.name} (${source.role}):`,
    `Previous outcome: ${result.status}`,
    `Previous summary: ${result.summary}`,
  ];

  if (Object.keys(result.details).length) {
    lines.push(
      `Details: ${JSON.stringify(result.details)}`,
    );
  }

  if (result.findings.length) {
    lines.push(
      "Findings:",
      ...result.findings.map((finding) => `- ${finding}`),
    );
  }

  if (result.filesChanged.length) {
    lines.push(
      "Files changed:",
      ...result.filesChanged.map((file) => `- ${file}`),
    );
  }

  if (result.commandsRun.length) {
    lines.push(
      "Commands run:",
      ...result.commandsRun.map((command) => `- ${command}`),
    );
  }

  if (Object.keys(result.validation).length) {
    lines.push(
      `Validation: ${JSON.stringify(result.validation)}`,
    );
  }

  if (result.commit) {
    lines.push(`Commit: ${result.commit}`);
  }

  return lines.join("\n");
}

/** Composes the single side-effect-free structured-result repair instruction. */
export function composeRepairInstruction(
  originalInstruction: string,
  invalidOutputExcerpt: string,
  validationErrors: string[],
): string {
  return [
    "Your only job is to repair the previous structured completion result.",
    "Do not execute or repeat the original task. Do not inspect the repository, modify/create/delete files, run terminal commands, or create Git commits. Do not perform any side effects.",
    "Use only the supplied previous-output excerpt and validation errors. Do not invent new implementation work. You may preserve an existing commit hash from the original execution if it was already reported, but do not create a new commit.",
    "",
    "Original task instruction, for context only:",
    originalInstruction,
    "",
    "Problems found with the previous result:",
    ...validationErrors.map((error) => `- ${error}`),
    "",
    "Previous output excerpt:",
    invalidOutputExcerpt,
    "",
    RESULT_CONTRACT,
    "",
    `Emit only the corrected ${RESULT_BLOCK_START}...${RESULT_BLOCK_END} block. The closing ${RESULT_BLOCK_END} tag must be the final non-whitespace content.`,
  ].join("\n");
}
