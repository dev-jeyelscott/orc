import type { AgentResult } from "@orc/shared";

import type { StartWorkerInput } from "./contracts.js";

// Stable delimiter the agent-execution-service scans for when extracting the structured
// completion contract from accumulated assistant message text. Kept as a named export so the
// service does not need to duplicate the literal strings.
export const RESULT_BLOCK_START = "<orc-result>";
export const RESULT_BLOCK_END = "</orc-result>";

const RESULT_CONTRACT = [
  "Structured completion contract:",
  `As the very last content of your final message, emit a single JSON object wrapped exactly in ${RESULT_BLOCK_START} and ${RESULT_BLOCK_END} delimiters, with nothing else between them. The JSON object must match this shape:`,
  '{"status":"completed"|"approved"|"changes_requested"|"blocked"|"failed","summary":"string","details":{},"findings":["string"],"filesChanged":["string"],"commandsRun":["string"],"validation":{},"commit":"string or null"}',
  "Field notes: `summary` is required and must be non-empty. `details`, `findings`, `filesChanged`, `commandsRun`, and `validation` may be empty but must be present as their respective empty value if you have nothing to report. `commit` must be the Git commit hash you created, or null if you did not create a commit.",
  `Do not include any text, code fences, or commentary between ${RESULT_BLOCK_START} and ${RESULT_BLOCK_END} other than that single JSON object.`,
].join("\n");

export function composeInitialInstruction(input: StartWorkerInput): string {
  const { agent, instruction, projectPath } = input;
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
    RESULT_CONTRACT,
  ].join("\n");
}

// Appended to the next agent's task instruction when the workflow router hands off from one
// agent to another (same-layer sequence or a configured route), so the receiving agent sees the
// structured result the previous agent reported instead of being re-run blind against the
// original task text alone.
export function composeHandoffNote(source: { name: string; role: string }, result: AgentResult): string {
  const lines = [
    `Handoff from ${source.name} (${source.role}):`,
    `Previous outcome: ${result.status}`,
    `Previous summary: ${result.summary}`,
  ];
  if (result.findings.length) lines.push("Findings:", ...result.findings.map((finding) => `- ${finding}`));
  if (result.filesChanged.length) lines.push(`Files changed: ${result.filesChanged.join(", ")}`);
  if (Object.keys(result.validation).length) lines.push(`Validation: ${JSON.stringify(result.validation)}`);
  return lines.join("\n");
}

// Composed for the single controlled repair turn when the previous attempt's output did not
// contain a valid structured result (missing/malformed <orc-result> block, invalid JSON, schema
// validation failure, or a policy violation such as reporting a commit while canCommit is
// false). Each harness invocation is a one-shot process, so the repair turn restates the
// original task instruction and the result contract rather than relying on conversation history.
export function composeRepairInstruction(
  originalInstruction: string,
  invalidOutputExcerpt: string,
  validationErrors: string[],
): string {
  return [
    "Your previous response did not include a valid structured completion result.",
    "",
    "Original task instruction:",
    originalInstruction,
    "",
    "Problems found with your previous result:",
    ...validationErrors.map((error) => `- ${error}`),
    "",
    "Excerpt of your previous output for reference:",
    invalidOutputExcerpt,
    "",
    RESULT_CONTRACT,
    "",
    `Re-emit only the corrected ${RESULT_BLOCK_START}...${RESULT_BLOCK_END} block as the last content of your final message. Do not repeat unrelated prior output.`,
  ].join("\n");
}
