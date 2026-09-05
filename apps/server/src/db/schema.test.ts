import {
  eq,
  inArray,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  DEVELOPMENT_ARCHITECT_AGENT_ID,
  DEVELOPMENT_BUILDER_AGENT_ID,
  DEVELOPMENT_QA_AGENT_ID,
  DEVELOPMENT_TEAM_ID,
  RESOLUTION_ARCHITECT_AGENT_ID,
  RESOLUTION_BUILDER_AGENT_ID,
  RESOLUTION_QA_AGENT_ID,
  RESOLUTION_TEAM_ID,
} from "./seed-ids.js";
import {
  db,
} from "./client.js";
import {
  agents,
  conversations,
  orchestratorSettings,
  runs,
  systemSettings,
  tasks,
  teams,
} from "./schema.js";

const createdTaskIds =
  new Set<string>();

const createdRunIds =
  new Set<string>();

const createdConversationIds =
  new Set<string>();

const createdAgentIds =
  new Set<string>();

const createdTeamIds =
  new Set<string>();

/**
 * Creates one disposable task row for schema-level persistence assertions.
 */
async function createTestTask(
  overrides: Partial<
    typeof tasks.$inferInsert
  > = {},
) {
  const [task] =
    await db
      .insert(tasks)
      .values({
        projectPath:
          `/tmp/orc-schema-${crypto.randomUUID()}`,
        title:
          "Schema test task",
        instruction:
          "Validate the task schema.",
        ...overrides,
      })
      .returning();

  createdTaskIds.add(
    task.id,
  );

  return task;
}

/**
 * Creates one disposable Team for schema-level persistence assertions.
 */
async function createTestTeam(
  label: string,
) {
  const [team] =
    await db
      .insert(teams)
      .values({
        slug:
          `schema-${label}-${crypto.randomUUID()}`,
        name:
          `Schema ${label}`,
      })
      .returning();

  createdTeamIds.add(
    team.id,
  );

  return team;
}

/**
 * Creates one disposable agent in a selected Team.
 */
async function createTestAgent(
  teamId: string,
  layer: number,
  executionOrder = 1,
) {
  const [agent] =
    await db
      .insert(agents)
      .values({
        teamId,
        slug:
          `schema-agent-${crypto.randomUUID()}`,
        name:
          "Schema Agent",
        role:
          "Schema Test",
        layer,
        executionOrder,
        harness:
          "codex",
        model:
          "default",
        reasoning:
          "high",
        systemPrompt:
          "Validate the agent schema.",
      })
      .returning();

  createdAgentIds.add(
    agent.id,
  );

  return agent;
}

afterEach(
  async () => {
    for (
      const conversationId of
      createdConversationIds
    ) {
      await db
        .delete(conversations)
        .where(
          eq(
            conversations.id,
            conversationId,
          ),
        );
    }

    for (
      const runId of
      createdRunIds
    ) {
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
      const taskId of
      createdTaskIds
    ) {
      await db
        .delete(tasks)
        .where(
          eq(
            tasks.id,
            taskId,
          ),
        );
    }

    for (
      const agentId of
      createdAgentIds
    ) {
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
      const teamId of
      createdTeamIds
    ) {
      await db
        .delete(teams)
        .where(
          eq(
            teams.id,
            teamId,
          ),
        );
    }

    createdConversationIds.clear();
    createdRunIds.clear();
    createdTaskIds.clear();
    createdAgentIds.clear();
    createdTeamIds.clear();

    await db
      .update(
        systemSettings,
      )
      .set({
        autoModeEnabled:
          false,
        updatedAt:
          new Date(),
      })
      .where(
        eq(
          systemSettings.id,
          1,
        ),
      );
  },
);

describe(
  "Team persistence schema",
  () => {
    it(
      "keeps deterministic Resolution and Development seed Teams",
      async () => {
        const rows =
          await db
            .select()
            .from(teams)
            .where(
              inArray(
                teams.id,
                [
                  RESOLUTION_TEAM_ID,
                  DEVELOPMENT_TEAM_ID,
                ],
              ),
            );

        expect(rows).toHaveLength(2);

        expect(
          rows.find(
            (team) =>
              team.id ===
              RESOLUTION_TEAM_ID,
          ),
        ).toMatchObject({
          slug:
            "resolution",
          name:
            "Resolution Team",
          enabled:
            true,
        });

        expect(
          rows.find(
            (team) =>
              team.id ===
              DEVELOPMENT_TEAM_ID,
          ),
        ).toMatchObject({
          slug:
            "development",
          name:
            "Development Team",
          enabled:
            true,
        });
      },
    );

    it(
      "keeps existing seed agents in Resolution and Development seed agents independent",
      async () => {
        const resolutionAgents =
          await db
            .select()
            .from(agents)
            .where(
              inArray(
                agents.id,
                [
                  RESOLUTION_ARCHITECT_AGENT_ID,
                  RESOLUTION_BUILDER_AGENT_ID,
                  RESOLUTION_QA_AGENT_ID,
                ],
              ),
            );

        expect(
          resolutionAgents,
        ).toHaveLength(3);

        expect(
          resolutionAgents.every(
            (agent) =>
              agent.teamId ===
              RESOLUTION_TEAM_ID,
          ),
        ).toBe(true);

        const developmentAgents =
          await db
            .select()
            .from(agents)
            .where(
              inArray(
                agents.id,
                [
                  DEVELOPMENT_ARCHITECT_AGENT_ID,
                  DEVELOPMENT_BUILDER_AGENT_ID,
                  DEVELOPMENT_QA_AGENT_ID,
                ],
              ),
            );

        expect(
          developmentAgents,
        ).toHaveLength(3);

        expect(
          developmentAgents.every(
            (agent) =>
              agent.teamId ===
                DEVELOPMENT_TEAM_ID &&
              agent.enabled ===
                false,
          ),
        ).toBe(true);

        expect(
          new Set(
            developmentAgents.map(
              (agent) =>
                agent.slug,
            ),
          ),
        ).toEqual(
          new Set([
            "development-architect",
            "development-builder",
            "development-qa",
          ]),
        );
      },
    );

    it(
      "uses Resolution as the compatibility default for existing writers",
      async () => {
        const task =
          await createTestTask();

        const [run] =
          await db
            .insert(runs)
            .values({
              projectPath:
                `/tmp/orc-schema-run-${crypto.randomUUID()}`,
              status:
                "completed",
            })
            .returning();

        createdRunIds.add(
          run.id,
        );

        const [conversation] =
          await db
            .insert(
              conversations,
            )
            .values({
              projectPath:
                `/tmp/orc-schema-conversation-${crypto.randomUUID()}`,
            })
            .returning();

        createdConversationIds.add(
          conversation.id,
        );

        const [agent] =
          await db
            .insert(agents)
            .values({
              slug:
                `schema-default-${crypto.randomUUID()}`,
              name:
                "Default Team Agent",
              role:
                "Schema Test",
              layer:
                900_000 +
                Math.floor(
                  Math.random() *
                    100_000,
                ),
              executionOrder:
                1,
              harness:
                "codex",
              model:
                "default",
              reasoning:
                "high",
              systemPrompt:
                "Validate Team defaults.",
            })
            .returning();

        createdAgentIds.add(
          agent.id,
        );

        expect(
          task.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          run.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          conversation.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          agent.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );
      },
    );

    it(
      "allows the same layer and execution order in different Teams",
      async () => {
        const firstTeam =
          await createTestTeam(
            "first",
          );

        const secondTeam =
          await createTestTeam(
            "second",
          );

        const layer =
          1_000_000 +
          Math.floor(
            Math.random() *
              100_000,
          );

        const firstAgent =
          await createTestAgent(
            firstTeam.id,
            layer,
          );

        const secondAgent =
          await createTestAgent(
            secondTeam.id,
            layer,
          );

        expect(
          firstAgent.layer,
        ).toBe(
          secondAgent.layer,
        );

        expect(
          firstAgent.executionOrder,
        ).toBe(
          secondAgent.executionOrder,
        );
      },
    );

    it(
      "rejects duplicate layer and execution order inside the same Team",
      async () => {
        const team =
          await createTestTeam(
            "duplicate-slot",
          );

        const layer =
          1_100_000 +
          Math.floor(
            Math.random() *
              100_000,
          );

        await createTestAgent(
          team.id,
          layer,
        );

        await expect(
          db
            .insert(agents)
            .values({
              teamId:
                team.id,
              slug:
                `schema-duplicate-${crypto.randomUUID()}`,
              name:
                "Duplicate Slot Agent",
              role:
                "Schema Test",
              layer,
              executionOrder:
                1,
              harness:
                "codex",
              model:
                "default",
              reasoning:
                "high",
              systemPrompt:
                "This insert should fail.",
            }),
        ).rejects.toThrow();
      },
    );

    it(
      "prevents deleting a Team that is still referenced",
      async () => {
        const team =
          await createTestTeam(
            "referenced",
          );

        await createTestAgent(
          team.id,
          1_200_000 +
            Math.floor(
              Math.random() *
                100_000,
            ),
        );

        await expect(
          db
            .delete(teams)
            .where(
              eq(
                teams.id,
                team.id,
              ),
            ),
        ).rejects.toThrow();
      },
    );
  },
);

describe(
  "Notion Auto Mode persistence schema",
  () => {
    it(
      "preserves manual task defaults",
      async () => {
        const task =
          await createTestTask();

        expect(
          task.source,
        ).toBe(
          "manual",
        );

        expect(
          task.externalId,
        ).toBeNull();

        expect(
          task.externalUrl,
        ).toBeNull();

        expect(
          task.priority,
        ).toBe(
          0,
        );
      },
    );

    it(
      "allows multiple tasks without an external identity",
      async () => {
        const first =
          await createTestTask();

        const second =
          await createTestTask();

        expect(
          first.externalId,
        ).toBeNull();

        expect(
          second.externalId,
        ).toBeNull();
      },
    );

    it(
      "enforces source and external ID uniqueness",
      async () => {
        const externalId =
          `notion-${crypto.randomUUID()}`;

        await createTestTask({
          source:
            "notion",
          externalId,
          externalUrl:
            "https://www.notion.so/example",
          priority:
            50,
        });

        await expect(
          db
            .insert(tasks)
            .values({
              projectPath:
                `/tmp/orc-schema-${crypto.randomUUID()}`,
              title:
                "Duplicate external task",
              instruction:
                "Should violate external identity.",
              source:
                "notion",
              externalId,
              priority:
                50,
            }),
        ).rejects.toThrow();
      },
    );

    it(
      "keeps system settings as a single global row",
      async () => {
        const [settings] =
          await db
            .select()
            .from(
              systemSettings,
            )
            .where(
              eq(
                systemSettings.id,
                1,
              ),
            );

        expect(
          settings,
        ).toBeDefined();

        await expect(
          db
            .insert(
              systemSettings,
            )
            .values({
              id:
                2,
              autoModeEnabled:
                true,
            }),
        ).rejects.toThrow();
      },
    );
  },
);

describe(
  "Orchestrator settings persistence schema",
  () => {
    it(
      "uses low as the database default without changing the persisted singleton",
      async () => {
        await expect(
          db.transaction(
            async (
              transaction,
            ) => {
              await transaction
                .delete(
                  orchestratorSettings,
                )
                .where(
                  eq(
                    orchestratorSettings.id,
                    1,
                  ),
                );

              const [settings] =
                await transaction
                  .insert(
                    orchestratorSettings,
                  )
                  .values({
                    id:
                      1,
                  })
                  .returning();

              expect(
                settings.reasoning,
              ).toBe(
                "low",
              );

              throw new Error(
                "rollback_orchestrator_settings_default_test",
              );
            },
          ),
        ).rejects.toThrow(
          "rollback_orchestrator_settings_default_test",
        );
      },
    );

    it(
      "keeps orchestrator settings as a single global row",
      async () => {
        await expect(
          db
            .insert(
              orchestratorSettings,
            )
            .values({
              id:
                2,
              harness:
                "codex",
              model:
                "default",
              reasoning:
                "low",
              systemPrompt:
                "Schema singleton test.",
            }),
        ).rejects.toThrow();
      },
    );
  },
);
