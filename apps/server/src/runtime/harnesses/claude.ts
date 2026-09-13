import type {
  HarnessAdapter,
  StartWorkerInput,
  UnsequencedRuntimeEvent,
} from "../contracts.js";

import { getKnowledgeMcpServerConfig } from "../../services/knowledge-mcp-client.js";

/** Namespaced tool names Claude exposes for one MCP server registered under this key. */
const KNOWLEDGE_MCP_SERVER_NAME = "knowledge_vault";
const KNOWLEDGE_MCP_ALLOWED_TOOLS = [
  `mcp__${KNOWLEDGE_MCP_SERVER_NAME}__search_knowledge`,
  `mcp__${KNOWLEDGE_MCP_SERVER_NAME}__get_note_section`,
];

const CLAUDE_EFFORT_LEVELS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** Converts complete Claude stream-json lines into normalized provider and usage events. */
function providerEvents(data: string): UnsequencedRuntimeEvent[] {
  return data.split(/\r?\n/).flatMap((line) => {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;

      if (event === null || Array.isArray(event)) {
        return [];
      }

      const translated: UnsequencedRuntimeEvent[] = [
        {
          type: "provider",
          provider: "claude",
          event,
        },
      ];

      if (
        event.usage
        && typeof event.usage === "object"
        && !Array.isArray(event.usage)
      ) {
        translated.push({
          type: "usage",
          usage: event.usage as Record<string, unknown>,
        });
      }

      return translated;
    } catch {
      return [];
    }
  });
}

/** Extracts Claude's final result text from the terminal result event. */
function extractMessageText(
  event: Record<string, unknown>,
): string | undefined {
  if (
    event.type === "result"
    && typeof event.result === "string"
    && event.result.length > 0
  ) {
    return event.result;
  }

  return undefined;
}

export const claudeHarness: HarnessAdapter = {
  harness: "claude",

  /** Builds the current one-shot Claude CLI invocation. */
  createInvocation(
    input: StartWorkerInput,
    prompt: string,
    environment: NodeJS.ProcessEnv,
  ) {
    if (!CLAUDE_EFFORT_LEVELS.has(input.agent.reasoning)) {
      throw new Error(
        `Unsupported Claude effort level: ${input.agent.reasoning}`,
      );
    }

    // Read-only durable knowledge retrieval (Slice 8): the same standalone MCP server
    // consumed server-side is offered to the worker itself, restricted to the two
    // approved read-only tools regardless of write/command capability. Absent when the
    // knowledge MCP command is not configured, so workers never point at nothing.
    const knowledgeServer = getKnowledgeMcpServerConfig();

    const allowedTools = [
      ...(input.agent.canWrite ? ["Edit", "Write", "NotebookEdit"] : []),
      ...(input.agent.canRunCommands ? ["Bash"] : []),
      ...(knowledgeServer ? KNOWLEDGE_MCP_ALLOWED_TOOLS : []),
    ];

    return {
      command: "claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(input.agent.model === "default"
          ? []
          : ["--model", input.agent.model]),
        "--effort",
        input.agent.reasoning,
        // Non-interactive runs have nothing attached to answer permission
        // prompts, so anything outside the configured capabilities must be
        // auto-denied instead of stalling the session waiting for approval.
        "--permission-prompts",
        "none",
        ...(knowledgeServer
          ? [
              "--mcp-config",
              JSON.stringify({
                mcpServers: {
                  [KNOWLEDGE_MCP_SERVER_NAME]: {
                    type: "stdio",
                    command: knowledgeServer.command,
                    args: knowledgeServer.args,
                    env: knowledgeServer.env,
                  },
                },
              }),
              // Ignore any ambient/project MCP configuration so a worker only ever
              // gets the one knowledge server ORC explicitly grants it here.
              "--strict-mcp-config",
            ]
          : []),
        // Passed as a single "--flag=value" token: --allowedTools takes a
        // variadic list, so a separate argv element would swallow the
        // trailing prompt argument as an additional tool name.
        ...(allowedTools.length > 0
          ? [`--allowedTools=${allowedTools.join(" ")}`]
          : []),
        prompt,
      ],
      cwd: input.projectPath,
      env: environment,
    };
  },

  translateOutput: providerEvents,
  extractMessageText,
};
