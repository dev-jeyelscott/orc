import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  db,
} from "../db/client.js";
import {
  agentExecutions,
  agents,
  departments,
  knowledgeCategories,
  runAgentSkills,
  runs,
  skillVersions,
  teamMembers,
} from "../db/schema.js";
import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  createAgent,
  previewAgent,
  deleteAgent,
  getAgent,
  listAgents,
  listEnabledAgentsForFutureRuns,
  updateAgent,
} from "./agent-service.js";
import {
  createDepartment,
  updateDepartment,
} from "./department-service.js";

const createdAgentIds =
  new Set<string>();

const createdRunIds =
  new Set<string>();

const createdDepartmentIds =
  new Set<string>();

const createdRoots: string[] = [];

/** Isolates canonical `.orc/` file writes from the real repository configuration root. */
async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-agent-service-test-"));
  createdRoots.push(root);
  return root;
}

/**
 * Creates a uniquely configured test agent and tracks it for cleanup.
 */
async function createTestAgent(
  label: string,
  options: {
    enabled?: boolean;
  } = {},
) {
  const [department] =
    await db
      .insert(departments)
      .values({
        slug:
          `test-department-${label.toLowerCase()}-${crypto.randomUUID()}`,
        name:
          `Test ${label} Department`,
        role:
          label,
        harness:
          "codex",
        defaultModel:
          "default",
        defaultReasoning:
          "high",
        systemPrompt:
          `Act as the ${label} test agent.`,
        canWrite:
          false,
        canRunCommands:
          true,
        canCommit:
          false,
      })
      .returning();

  createdDepartmentIds.add(
    department.id,
  );

  const [agent] =
    await db
      .insert(agents)
      .values({
        departmentId:
          department.id,
        slug:
          `test-${label.toLowerCase()}-${crypto.randomUUID()}`,
        name:
          `Test ${label}`,
        enabled:
          options.enabled ??
          true,
      })
      .returning();

  createdAgentIds.add(
    agent.id,
  );

  return agent;
}

/**
 * Creates a tracked run with the supplied workflow snapshot and status.
 */
async function createTestRun(
  workflowSnapshot:
    unknown,
  status:
    | "pending"
    | "running"
    | "completed" =
    "completed",
) {
  const [run] =
    await db
      .insert(runs)
      .values({
        projectPath:
          "/tmp/orc-agent-service-test",
        status,
        workflowSnapshot,
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  return run;
}

describe(
  "agent-service",
  () => {
    afterEach(
      async () => {
        for (
          const runId of
          createdRunIds
        ) {
          await db
            .delete(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.runId,
                runId,
              ),
            );

          await db
            .delete(runs)
            .where(
              eq(
                runs.id,
                runId,
              ),
            );
        }

        for (
          const agentId of
          createdAgentIds
        ) {
          await db
            .delete(teamMembers)
            .where(
              eq(
                teamMembers.agentId,
                agentId,
              ),
            );

          await db
            .delete(agents)
            .where(
              eq(
                agents.id,
                agentId,
              ),
            );
        }

        for (
          const departmentId of
          createdDepartmentIds
        ) {
          await db
            .delete(departments)
            .where(
              eq(
                departments.id,
                departmentId,
              ),
            );
        }

        createdRunIds.clear();
        createdAgentIds.clear();
        createdDepartmentIds.clear();
        for (const root of createdRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
      },
    );

    it("round-trips runtime overrides and clears them back to inheritance", async () => {
      const root = await makeConfigRoot();
      // The owning Department must be file-backed for `updateAgent` to pass
      // cross-graph validation; the Agent row itself stays DB-only until its
      // first update self-heals a canonical file for it.
      const department = await createDepartment(
        {
          slug: `test-department-overrides-${crypto.randomUUID()}`,
          name: "Test Overrides Department",
          role: "Overrides",
          harness: "codex",
          defaultModel: "default",
          defaultReasoning: "high",
          systemPrompt: "Act as the Overrides test agent.",
          canWrite: false,
          canRunCommands: true,
          canCommit: false,
        },
        root,
      );
      createdDepartmentIds.add(department.id);
      const [row] = await db
        .insert(agents)
        .values({
          departmentId: department.id,
          slug: `test-overrides-${crypto.randomUUID()}`,
          name: "Test Overrides",
          enabled: true,
        })
        .returning();
      createdAgentIds.add(row.id);
      const overrides = { harnessOverride: "claude" as const, modelOverride: "claude-sonnet-5", reasoningOverride: "low", canWriteOverride: true, canRunCommandsOverride: false, canCommitOverride: true, sandboxModeOverride: "read-only" as const, additionalPrompt: "Specialize in verification." };
      const saved = await updateAgent(row.id, overrides, null, root);
      expect(saved).toMatchObject({ ...overrides, hasHarnessOverride: true, hasCanWriteOverride: true, hasCanRunCommandsOverride: true, hasSandboxModeOverride: true, hasCanCommitOverride: true, effective: { harness: "claude", canWrite: true, canRunCommands: false, canCommit: true, sandboxMode: "read-only" } });
      expect(await getAgent(row.id, root)).toEqual(saved);
      expect(await updateAgent(row.id, { name: "Renamed override" }, saved!.configRevision, root)).toMatchObject(overrides);
      const cleared = await updateAgent(row.id, { harnessOverride: null, modelOverride: null, reasoningOverride: null, canWriteOverride: null, canRunCommandsOverride: null, sandboxModeOverride: null, canCommitOverride: null }, null, root);
      expect(cleared).toMatchObject({ hasHarnessOverride: false, hasCanRunCommandsOverride: false, effective: { harness: "codex", canWrite: false, canRunCommands: true, canCommit: false } });
      const beforePreview = await getAgent(row.id, root);
      expect(await previewAgent({ departmentId: row.departmentId, enabled: true, additionalPrompt: "Draft only", canRunCommandsOverride: false })).toMatchObject({ canRunCommands: false });
      expect(await getAgent(row.id, root)).toEqual(beforePreview);
    });

    it(
      "preserves historical executions and snapshots after safe deletion",
      async () => {
        const root = await makeConfigRoot();
        const source =
          await createTestAgent(
            "Historical",
          );

        const workflowSnapshot = {
          agents: [
            {
              id:
                source.id,
              name:
                source.name,
              role:
                "Historical",
            },
          ],
          routes: [],
        };

        const run =
          await createTestRun(
            workflowSnapshot,
            "completed",
          );

        const [execution] =
          await db
            .insert(
              agentExecutions,
            )
            .values({
              runId:
                run.id,
              agentId:
                source.id,
              agentName:
                source.name,
              agentRole:
                "Historical",
              layer:
                1,
              executionOrder:
                1,
              harness:
                "codex",
              model:
                "default",
              reasoning:
                "high",
              status:
                "completed",
              completedAt:
                new Date(),
            })
            .returning();

        expect(
          await deleteAgent(
            source.id,
            null,
            root,
          ),
        ).toBe(true);

        const [historicalExecution] =
          await db
            .select()
            .from(
              agentExecutions,
            )
            .where(
              eq(
                agentExecutions.id,
                execution.id,
              ),
            );

        expect(
          historicalExecution,
        ).toMatchObject({
          id:
            execution.id,
          agentId:
            null,
          agentName:
            source.name,
          agentRole:
            "Historical",
        });

        const [historicalRun] =
          await db
            .select()
            .from(runs)
            .where(
              eq(
                runs.id,
                run.id,
              ),
            );

        expect(
          historicalRun.workflowSnapshot,
        ).toEqual(
          workflowSnapshot,
        );
      },
    );

    it("archives instead of deleting an Agent that Run history still references", async () => {
      const root = await makeConfigRoot();
      const source = await createTestAgent("Archived");
      const run = await createTestRun({ agents: [], routes: [] }, "completed");
      const contentHash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
      await db.insert(skillVersions).values({ contentHash, content: "Skill body." });
      await db.insert(runAgentSkills).values({ runId: run.id, agentId: source.id, skillSlug: "historical-skill", name: "Historical Skill", contentHash });

      expect(await deleteAgent(source.id, null, root)).toBe(true);

      const [archived] = await db.select().from(agents).where(eq(agents.id, source.id));
      expect(archived).toMatchObject({ enabled: false, archivedAt: expect.any(Date) });
      expect((await listAgents(root)).map((agent) => agent.id)).not.toContain(source.id);
      expect((await listEnabledAgentsForFutureRuns()).map((agent) => agent.id)).not.toContain(source.id);
    });

    it("refuses to delete a Knowledge Category specialist before touching its canonical file", async () => {
      const root = await makeConfigRoot();
      const department = await createDepartment(
        {
          slug: `test-department-specialist-${crypto.randomUUID()}`,
          name: "Test Specialist Department",
          role: "Specialist",
          harness: "codex",
          defaultModel: "default",
          defaultReasoning: "high",
          systemPrompt: "Act as the specialist test agent.",
          canWrite: false,
          canRunCommands: true,
          canCommit: false,
        },
        root,
      );
      createdDepartmentIds.add(department.id);
      const agent = await createAgent(
        { departmentId: department.id, slug: `test-specialist-${crypto.randomUUID()}`, name: "Test Specialist", enabled: true, additionalPrompt: "" },
        root,
      );
      createdAgentIds.add(agent.id);
      const [category] = await db
        .insert(knowledgeCategories)
        .values({ slug: `test-category-${crypto.randomUUID()}`, name: "Test Guidelines", vaultRootPath: "test-guidelines", specialistAgentId: agent.id })
        .returning();

      try {
        await expect(deleteAgent(agent.id, null, root)).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringContaining('"Test Guidelines"'),
        });
        await expect(fs.stat(path.join(root, "agents", agent.slug, "agent.yaml"))).resolves.toBeTruthy();
        expect(await getAgent(agent.id, root)).not.toBeNull();
      } finally {
        await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, category.id));
      }
    });

    it(
      "rejects deletion when an active run snapshot contains the agent",
      async () => {
        const source =
          await createTestAgent(
            "Active",
          );

        const run =
          await createTestRun(
            {
              agents: [
                {
                  id:
                    source.id,
                  name:
                    source.name,
                  role:
                    "Active",
                },
              ],
              routes: [],
            },
            "running",
          );

        await expect(
          deleteAgent(
            source.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              run.id,
            ),
        });
      },
    );

    it(
      "requires a valid Department and resolves inherited effective configuration",
      async () => {
        const root = await makeConfigRoot();
        const department =
          await createDepartment(
            {
              slug:
                `agent-service-department-${crypto.randomUUID()}`,
              name:
                "Inheritance Department",
              role:
                "Reviewer",
              harness:
                "codex",
              defaultModel:
                "default-model",
              defaultReasoning:
                "medium",
              systemPrompt:
                "Review carefully.",
              canWrite:
                false,
              canRunCommands:
                true,
              canCommit:
                false,
            },
            root,
          );

        createdDepartmentIds.add(
          department.id,
        );

        await expect(
          createAgent(
            {
              departmentId:
                "00000000-0000-4000-9000-00000000dead",
              slug:
                `agent-service-invalid-department-${crypto.randomUUID()}`,
              name:
                "Invalid Department Agent",
              enabled:
                true,
              additionalPrompt:
                "",
            },
            root,
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
        });

        const agent =
          await createAgent(
            {
              departmentId:
                department.id,
              slug:
                `agent-service-inherit-${crypto.randomUUID()}`,
              name:
                "Inheriting Agent",
              enabled:
                true,
              additionalPrompt:
                "",
            },
            root,
          );

        createdAgentIds.add(
          agent.id,
        );

        expect(agent.currentTeamId).toBeNull();
        expect(await db.select().from(teamMembers).where(eq(teamMembers.agentId, agent.id))).toHaveLength(0);

        expect(
          agent.effective.model,
        ).toBe(
          "default-model",
        );

        expect(
          agent.effective.reasoning,
        ).toBe(
          "medium",
        );

        expect(
          agent.effective.systemPrompt,
        ).toBe(
          "Review carefully.",
        );

        expect(
          agent.hasModelOverride,
        ).toBe(false);

        const overridden =
          await updateAgent(
            agent.id,
            {
              modelOverride:
                "claude-sonnet-5",
              reasoningOverride:
                "high",
              additionalPrompt:
                "Focus on billing.",
            },
            agent.configRevision,
            root,
          );

        expect(
          overridden?.effective.model,
        ).toBe(
          "claude-sonnet-5",
        );

        expect(
          overridden?.effective.reasoning,
        ).toBe(
          "high",
        );

        expect(
          overridden?.effective.systemPrompt,
        ).toBe(
          "Review carefully.\n\nFocus on billing.",
        );

        expect(
          overridden?.hasModelOverride,
        ).toBe(true);

        await updateDepartment(
          department.id,
          {
            enabled:
              false,
          },
          department.configRevision,
          root,
        );

        const withDisabledDepartment =
          await getAgent(
            agent.id,
            root,
          );

        expect(
          withDisabledDepartment?.effective.enabled,
        ).toBe(false);

        expect(
          withDisabledDepartment?.enabled,
        ).toBe(true);
      },
    );

    it(
      "resolves currentTeamId from team_members and reports null when unassigned",
      async () => {
        const unassigned =
          await createTestAgent(
            "Unassigned",
          );

        expect(
          (
            await getAgent(
              unassigned.id,
            )
          )?.currentTeamId,
        ).toBeNull();

        const assigned =
          await createTestAgent(
            "Assigned",
          );

        await db
          .insert(teamMembers)
          .values({
            teamId:
              RESOLUTION_TEAM_ID,
            departmentId:
              assigned.departmentId,
            agentId:
              assigned.id,
            layer:
              9_000_000 +
              Math.floor(
                Math.random() *
                  100_000,
              ),
            executionOrder:
              1,
          });

        expect(
          (
            await getAgent(
              assigned.id,
            )
          )?.currentTeamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        const listed =
          await listAgents();

        expect(
          listed.find(
            (agent) =>
              agent.id ===
              assigned.id,
          )?.currentTeamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          listed.find(
            (agent) =>
              agent.id ===
              unassigned.id,
          )?.currentTeamId,
        ).toBeNull();

        const enabledForFutureRuns =
          await listEnabledAgentsForFutureRuns();

        expect(
          enabledForFutureRuns.find(
            (agent) =>
              agent.id ===
              assigned.id,
          )?.currentTeamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );
      },
    );
  },
);
