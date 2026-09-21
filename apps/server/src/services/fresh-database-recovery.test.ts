import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { WorkflowGraph, WorkflowGraphNode } from "@orc/shared";

import { db } from "../db/client.js";
import {
  agents,
  agentSkills,
  departments,
  projectTeamAssignments,
  skills,
  teamMembers,
  teams,
  workflowEdges,
  workflowNodes,
  workflowRevisions,
} from "../db/schema.js";
import { createAgent, replaceAgentSkills } from "./agent-service.js";
import { synchronizeConfiguration } from "./config-sync-service.js";
import { createDepartment } from "./department-service.js";
import { createSkill } from "./skill-service.js";
import { replaceTeamMembers } from "./team-membership.js";
import { createTeam } from "./team-service.js";
import { upsertProjectTeamAssignment } from "./project-team-assignment-service.js";
import { getOrCreateDraft, publishDraft, saveDraftGraph } from "./workflow-graph-service.js";

/**
 * Roadmap Vertical Spec 8: proves that destroying every PostgreSQL
 * configuration projection row this fixture describes and running
 * `synchronizeConfiguration` against the unchanged `.orc/` tree
 * reconstructs equivalent Departments, Agents, Skill assignments, Team
 * membership, the Published workflow, and Project assignment -- compared
 * by canonical slug/path identity, never by DB UUID (roadmap invariant #6).
 */
describe("Fresh-database recovery proof (Vertical Spec 8)", () => {
  it("reconstructs the full configuration projection from .orc/ alone", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-recovery-config-"));
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orc-recovery-workspace-"));
    const suffix = crypto.randomUUID();

    try {
      await fs.writeFile(path.join(configRoot, "orc.yaml"), `version: 1\nworkspaceRoot: ${JSON.stringify(workspaceRoot)}\n`, "utf8");
      const projectPath = path.join(workspaceRoot, "recovery-project");
      await fs.mkdir(path.join(projectPath, ".git"), { recursive: true });

      // --- Build the full configuration graph through the file-authoritative services. ---
      const department = await createDepartment(
        {
          slug: `recovery-department-${suffix}`,
          name: "Recovery Department",
          role: "Engineer",
          harness: "codex" as const,
          defaultModel: "default",
          defaultReasoning: "high",
          systemPrompt: "Act as the recovery test department.",
        },
        configRoot,
      );

      const skill = await createSkill(
        { slug: `recovery-skill-${suffix}`, name: "Recovery Skill", description: "", enabled: true, tags: [], domains: [] },
        configRoot,
      );

      const agent = await createAgent(
        {
          departmentId: department.id,
          slug: `recovery-agent-${suffix}`,
          name: "Recovery Agent",
          enabled: true,
          additionalPrompt: "Recovery instructions.",
        },
        configRoot,
      );
      await replaceAgentSkills(agent.id, [skill.id], configRoot);

      const team = await createTeam(
        { slug: `recovery-team-${suffix}`, name: "Recovery Team", description: "", enabled: true },
        configRoot,
      );
      await replaceTeamMembers(team.id, [agent.id], null, configRoot);

      const draft = await getOrCreateDraft(team.id);
      const start = draft.graph.nodes.find((node): node is Extract<WorkflowGraphNode, { kind: "start" }> => node.kind === "start")!;
      const completeRun = draft.graph.nodes.find(
        (node): node is Extract<WorkflowGraphNode, { kind: "terminal" }> => node.kind === "terminal" && node.terminalAction === "complete_run",
      )!;
      const agentNode: Extract<WorkflowGraphNode, { kind: "agent" }> = { id: crypto.randomUUID(), kind: "agent", agentId: agent.id, position: { x: 0, y: 240 } };
      const graph: WorkflowGraph = {
        nodes: [...draft.graph.nodes, agentNode],
        edges: [
          { id: crypto.randomUUID(), sourceNodeId: start.id, targetNodeId: agentNode.id, outcome: null },
          { id: crypto.randomUUID(), sourceNodeId: agentNode.id, targetNodeId: completeRun.id, outcome: "completed" },
          { id: crypto.randomUUID(), sourceNodeId: agentNode.id, targetNodeId: completeRun.id, outcome: "approved" },
        ],
      };
      await saveDraftGraph(team.id, graph, configRoot);
      const published = await publishDraft(team.id, configRoot);

      await upsertProjectTeamAssignment(projectPath, { teamId: team.id, notionDataSourceId: null, autoModeEnabled: false }, configRoot);

      // --- Simulate a fresh database: drop every projection row this tree describes. ---
      await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.resolutionTeamId, team.id));
      const revisionRows = await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.teamId, team.id));
      for (const revision of revisionRows) {
        await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revision.id));
        await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revision.id));
      }
      await db.delete(workflowRevisions).where(eq(workflowRevisions.teamId, team.id));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
      await db.delete(teams).where(eq(teams.id, team.id));
      await db.delete(agentSkills).where(eq(agentSkills.agentId, agent.id));
      await db.delete(agents).where(eq(agents.id, agent.id));
      await db.delete(skills).where(eq(skills.id, skill.id));
      await db.delete(departments).where(eq(departments.id, department.id));

      expect(await db.select().from(departments).where(eq(departments.slug, department.slug))).toHaveLength(0);
      expect(await db.select().from(teams).where(eq(teams.slug, team.slug))).toHaveLength(0);

      // --- Run migrations/system bootstrap equivalent: explicit sync against the unchanged tree. ---
      const result = await synchronizeConfiguration(configRoot);
      expect(result.status).toBe("synced");

      // --- Compare reconstructed state by slug identity, never by UUID. ---
      const [reDepartment] = await db.select().from(departments).where(eq(departments.slug, department.slug));
      expect(reDepartment).toMatchObject({ name: "Recovery Department", role: "Engineer" });

      const [reSkill] = await db.select().from(skills).where(eq(skills.slug, skill.slug));
      expect(reSkill).toBeDefined();

      const [reAgent] = await db.select().from(agents).where(eq(agents.slug, agent.slug));
      expect(reAgent).toMatchObject({ departmentId: reDepartment.id, additionalPrompt: "Recovery instructions." });

      const agentSkillRows = await db.select().from(agentSkills).where(eq(agentSkills.agentId, reAgent.id));
      expect(agentSkillRows.map((row) => row.skillId)).toContain(reSkill.id);

      const [reTeam] = await db.select().from(teams).where(eq(teams.slug, team.slug));
      expect(reTeam).toBeDefined();

      const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, reTeam.id));
      expect(memberRows.map((row) => row.agentId)).toContain(reAgent.id);

      const [rePublished] = await db
        .select()
        .from(workflowRevisions)
        .where(and(eq(workflowRevisions.teamId, reTeam.id), eq(workflowRevisions.state, "published")));
      expect(rePublished.version).toBe(published.revision.version);

      const publishedNodeRows = await db.select().from(workflowNodes).where(eq(workflowNodes.revisionId, rePublished.id));
      expect(publishedNodeRows.some((row) => row.kind === "agent" && row.agentId === reAgent.id)).toBe(true);

      const [reAssignment] = await db.select().from(projectTeamAssignments).where(eq(projectTeamAssignments.resolutionTeamId, reTeam.id));
      expect(reAssignment).toMatchObject({ projectPath: path.resolve(projectPath) });

      // Clean up every row this fixture (re)created, including what sync reprojected --
      // this test runs against the shared dev database, so nothing may be left behind.
      await db.delete(projectTeamAssignments).where(eq(projectTeamAssignments.resolutionTeamId, reTeam.id));
      const finalRevisionRows = await db.select({ id: workflowRevisions.id }).from(workflowRevisions).where(eq(workflowRevisions.teamId, reTeam.id));
      for (const revision of finalRevisionRows) {
        await db.delete(workflowEdges).where(eq(workflowEdges.revisionId, revision.id));
        await db.delete(workflowNodes).where(eq(workflowNodes.revisionId, revision.id));
      }
      await db.delete(workflowRevisions).where(eq(workflowRevisions.teamId, reTeam.id));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, reTeam.id));
      await db.delete(teams).where(eq(teams.id, reTeam.id));
      await db.delete(agentSkills).where(eq(agentSkills.agentId, reAgent.id));
      await db.delete(agents).where(eq(agents.id, reAgent.id));
      await db.delete(skills).where(eq(skills.id, reSkill.id));
      await db.delete(departments).where(eq(departments.id, reDepartment.id));
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
