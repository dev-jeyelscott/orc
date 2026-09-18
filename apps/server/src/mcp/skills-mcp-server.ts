#!/usr/bin/env node
/**
 * ORC's own generic Skill capability, exposed to worker harnesses as a
 * standalone stdio MCP server (roadmap Vertical Spec 3, section 12.5-12.7).
 * Spawned per Agent Execution by `getSkillsMcpServerConfig`, scoped to
 * exactly one Run + Agent via `ORC_SKILLS_RUN_ID`/`ORC_SKILLS_AGENT_ID`.
 * `search_skills`/`load_skill` never read the live `.orc/skills` catalog --
 * only that Run + Agent's frozen assignment (`run_agent_skills`), so a Skill
 * edited mid-Run never changes what an in-flight Run sees.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  DEFAULT_SKILL_SEARCH_LIMIT,
  MAX_SKILL_SEARCH_LIMIT,
  loadAssignedSkill,
  searchAssignedSkills,
} from "../services/skill-discovery-service.js";

const runId = process.env.ORC_SKILLS_RUN_ID;
const agentId = process.env.ORC_SKILLS_AGENT_ID;

if (!runId || !agentId) {
  process.stderr.write("orc-skills-mcp: ORC_SKILLS_RUN_ID and ORC_SKILLS_AGENT_ID are required\n");
  process.exit(1);
}

const server = new McpServer({ name: "orc-skills", version: "1.0.0" });

server.registerTool(
  "search_skills",
  {
    description:
      "Search this Agent's assigned Skills for the current Run. Returns bounded candidate metadata only -- call load_skill on an exact slug to get full instructions.",
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().positive().max(MAX_SKILL_SEARCH_LIMIT).optional(),
    },
  },
  async ({ query, limit }) => {
    const results = await searchAssignedSkills(runId, agentId, query, limit ?? DEFAULT_SKILL_SEARCH_LIMIT);
    return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
  },
);

server.registerTool(
  "load_skill",
  {
    description: "Load one exact assigned Skill's full instructions by slug.",
    inputSchema: {
      slug: z.string().trim().min(1).max(100),
    },
  },
  async ({ slug }) => {
    const skill = await loadAssignedSkill(runId, agentId, slug);
    if (!skill) {
      return {
        isError: true,
        content: [{ type: "text", text: `Skill "${slug}" is not assigned to this Agent for the current Run.` }],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(skill) }] };
  },
);

await server.connect(new StdioServerTransport());
