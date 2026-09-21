import type {
  HarnessAdapter,
  StartWorkerInput,
  UnsequencedRuntimeEvent,
  WorkLifecycleEvent,
} from "../contracts.js";

import { getKnowledgeMcpServerConfig } from "../../services/knowledge-mcp-client.js";
import { getSkillsMcpServerConfig, type SkillsMcpServerConfig } from "../../mcp/skills-mcp-client-config.js";

const KNOWLEDGE_MCP_SERVER_NAME = "knowledge_vault";
const SKILLS_MCP_SERVER_NAME = "orc_skills";

/** Serializes one string as a quoted TOML value for a `-c key=value` override. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Serializes a flat string map as a TOML inline table for a `-c key=value` override. */
function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values)
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");

  return `{ ${entries} }`;
}

/**
 * Builds the `-c mcp_servers.<name>.*` overrides that grant this Codex invocation the
 * same read-only standalone knowledge MCP server ORC's own process consumes (Slice 8).
 * Returns an empty array when no knowledge MCP command is configured.
 */
function knowledgeMcpConfigArgs(): string[] {
  const knowledgeServer = getKnowledgeMcpServerConfig();

  if (!knowledgeServer) {
    return [];
  }

  const args: string[] = [
    "-c",
    `mcp_servers.${KNOWLEDGE_MCP_SERVER_NAME}.command=${tomlString(knowledgeServer.command)}`,
  ];

  if (Object.keys(knowledgeServer.env).length > 0) {
    args.push(
      "-c",
      `mcp_servers.${KNOWLEDGE_MCP_SERVER_NAME}.env=${tomlInlineTable(knowledgeServer.env)}`,
    );
  }

  return args;
}

/**
 * Builds the `-c mcp_servers.<name>.*` overrides that grant this Codex
 * invocation ORC's own generic Skill capability (roadmap Vertical Spec 3),
 * scoped to the current Run + Agent's frozen assignment. Returns an empty
 * array outside a Run (`skillScope` absent).
 */
function skillsMcpConfigArgs(skillsServer: SkillsMcpServerConfig | null): string[] {
  if (!skillsServer) {
    return [];
  }

  return [
    "-c",
    `mcp_servers.${SKILLS_MCP_SERVER_NAME}.command=${tomlString(skillsServer.command)}`,
    "-c",
    `mcp_servers.${SKILLS_MCP_SERVER_NAME}.args=${JSON.stringify(skillsServer.args)}`,
    "-c",
    `mcp_servers.${SKILLS_MCP_SERVER_NAME}.env=${tomlInlineTable(skillsServer.env)}`,
  ];
}

const CODEX_REASONING_LEVELS = new Set([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

/** Converts complete Codex JSON lines into normalized provider and usage events. */
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
          provider: "codex",
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

/**
 * Extracts assistant-authored text from Codex completed agent-message events.
 *
 * Verified provider shape:
 * item.completed.item.type === "agent_message"
 */
function extractMessageText(
  event: Record<string, unknown>,
): string | undefined {
  if (event.type !== "item.completed") {
    return undefined;
  }

  const item = event.item as {
    type?: unknown;
    text?: unknown;
  } | undefined;

  if (
    item?.type === "agent_message"
    && typeof item.text === "string"
    && item.text.length > 0
  ) {
    return item.text;
  }

  return undefined;
}

/** Identifies shell constructs that detach work from the worker's terminal lifecycle. */
function isDetachedCommand(command: string): boolean {
  return /\b(?:nohup|disown|setsid)\b|(?:^|[^&>])&(?![&>])/.test(
    command,
  );
}

/** Extracts Codex command item lifecycle without exposing its event shape to the runtime. */
function extractWorkLifecycleEvent(
  event: Record<string, unknown>,
): WorkLifecycleEvent | undefined {
  if (event.type !== "item.started" && event.type !== "item.completed") {
    return undefined;
  }

  const item = event.item as {
    id?: unknown;
    type?: unknown;
    command?: unknown;
  } | undefined;

  if (item?.type !== "command_execution" || typeof item.id !== "string") {
    return undefined;
  }

  return {
    id: item.id,
    state: event.type === "item.started" ? "started" : "completed",
    ...(typeof item.command === "string" && isDetachedCommand(item.command)
      ? { detached: true }
      : {}),
  };
}

export const codexHarness: HarnessAdapter = {
  harness: "codex",

  /** Builds the current one-shot Codex CLI invocation. */
  createInvocation(
    input: StartWorkerInput,
    prompt: string,
    environment: NodeJS.ProcessEnv,
  ) {
    if (!CODEX_REASONING_LEVELS.has(input.agent.reasoning)) {
      throw new Error(
        `Unsupported Codex reasoning level: ${input.agent.reasoning}`,
      );
    }

    const sandboxMode = input.agent.sandboxMode ??
      (input.agent.canWrite || input.agent.canRunCommands
        ? "workspace-write"
        : "read-only");

    const skillsServer = input.skillScope
      ? getSkillsMcpServerConfig(input.skillScope.runId, input.skillScope.agentId)
      : null;

    return {
      command: "codex",
      args: [
        "exec",
        "--json",
        ...(input.agent.model === "default"
          ? []
          : ["--model", input.agent.model]),
        "--config",
        `model_reasoning_effort=${input.agent.reasoning}`,
        "--sandbox",
        sandboxMode,
        // Read-only durable knowledge retrieval (Slice 8), granted regardless of
        // sandbox/write/command capability. Absent when no knowledge MCP command is
        // configured.
        ...knowledgeMcpConfigArgs(),
        // Generic lazy Skill discovery (roadmap Vertical Spec 3), scoped to
        // the current Run + Agent's frozen assignment. Absent outside a Run.
        ...skillsMcpConfigArgs(skillsServer),
        prompt,
      ],
      cwd: input.projectPath,
      env: environment,
    };
  },

  translateOutput: providerEvents,
  extractMessageText,
  extractWorkLifecycleEvent,
};
