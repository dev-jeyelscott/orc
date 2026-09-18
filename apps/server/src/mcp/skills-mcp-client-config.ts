import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "../config/env.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export type SkillsMcpServerConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

/**
 * Describes ORC's own generic Skill capability as a standalone stdio MCP
 * server, scoped to exactly one Run + Agent Execution (roadmap Vertical Spec
 * 3, section 12.7). Both Claude and Codex adapters wire this the same way
 * they wire the standalone Knowledge MCP server: as an external command this
 * process starts, never as harness-specific tooling.
 *
 * In development the server runs directly from TypeScript source via `tsx`
 * (matching how the parent process itself starts); in a built server it runs
 * the compiled `.js` sibling instead.
 */
export function getSkillsMcpServerConfig(runId: string, agentId: string): SkillsMcpServerConfig {
  const isDev = env.NODE_ENV !== "production";
  const scriptPath = path.join(currentDir, isDev ? "skills-mcp-server.ts" : "skills-mcp-server.js");

  return {
    command: process.execPath,
    args: isDev ? ["--import", "tsx", scriptPath] : [scriptPath],
    env: {
      DATABASE_URL: env.DATABASE_URL,
      ORC_SKILLS_RUN_ID: runId,
      ORC_SKILLS_AGENT_ID: agentId,
    },
  };
}
