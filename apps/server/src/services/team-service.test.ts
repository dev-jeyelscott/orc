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
  agents,
  conversations,
  departments,
  runs,
  tasks,
  teams,
} from "../db/schema.js";
import {
  TeamServiceError,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "./team-service.js";

const createdDepartmentIds =
  new Set<string>();

const createdTeamIds =
  new Set<string>();

/**
 * Creates and tracks one disposable Team.
 */
async function createTestTeam(
  label: string,
) {
  const team =
    await createTeam({
      slug:
        `team-service-${label}-${crypto.randomUUID()}`,
      name:
        `Team Service ${label}`,
      description:
        "",
      enabled:
        true,
    });

  createdTeamIds.add(
    team.id,
  );

  return team;
}

/**
 * Removes all test references belonging to tracked Teams before deleting the Teams.
 */
async function cleanupTrackedTeams() {
  for (
    const teamId of
    createdTeamIds
  ) {
    await db
      .delete(
        conversations,
      )
      .where(
        eq(
          conversations.teamId,
          teamId,
        ),
      );

    await db
      .delete(runs)
      .where(
        eq(
          runs.teamId,
          teamId,
        ),
      );

    await db
      .delete(tasks)
      .where(
        eq(
          tasks.teamId,
          teamId,
        ),
      );

    await db
      .delete(agents)
      .where(
        eq(
          agents.teamId,
          teamId,
        ),
      );

    await db
      .delete(teams)
      .where(
        eq(
          teams.id,
          teamId,
        ),
      );
  }

  for (const departmentId of createdDepartmentIds) {
    await db
      .delete(departments)
      .where(
        eq(
          departments.id,
          departmentId,
        ),
      );
  }

  createdTeamIds.clear();
  createdDepartmentIds.clear();
}

afterEach(
  cleanupTrackedTeams,
);

describe(
  "team-service",
  () => {
    it(
      "creates, reads, updates, lists, and deletes an empty Team",
      async () => {
        const team =
          await createTestTeam(
            "crud",
          );

        expect(
          await getTeam(
            team.id,
          ),
        ).toMatchObject({
          id:
            team.id,
          enabled:
            true,
        });

        expect(
          (
            await listTeams()
          ).some(
            (candidate) =>
              candidate.id ===
              team.id,
          ),
        ).toBe(true);

        const updated =
          await updateTeam(
            team.id,
            {
              name:
                "Updated Team",
              enabled:
                false,
            },
          );

        expect(
          updated,
        ).toMatchObject({
          id:
            team.id,
          name:
            "Updated Team",
          enabled:
            false,
        });

        expect(
          await deleteTeam(
            team.id,
          ),
        ).toBe(true);

        createdTeamIds.delete(
          team.id,
        );

        expect(
          await getTeam(
            team.id,
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects duplicate Team slugs",
      async () => {
        const slug =
          `duplicate-${crypto.randomUUID()}`;

        const first =
          await createTeam({
            slug,
            name:
              "First Duplicate",
            description:
              "",
            enabled:
              true,
          });

        createdTeamIds.add(
          first.id,
        );

        await expect(
          createTeam({
            slug,
            name:
              "Second Duplicate",
            description:
              "",
            enabled:
              true,
          }),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });
      },
    );

    it(
      "round-trips Team-owned Notion automation configuration",
      async () => {
        const dataSourceId =
          `notion-source-${crypto.randomUUID()}`;

        const team =
          await createTeam({
            slug:
              `automation-${crypto.randomUUID()}`,
            name:
              "Automation Team",
            description:
              "",
            enabled:
              true,
            notionDataSourceId:
              dataSourceId,
            autoModeEnabled:
              true,
          });

        createdTeamIds.add(
          team.id,
        );

        expect(
          await getTeam(
            team.id,
          ),
        ).toMatchObject({
          notionDataSourceId:
            dataSourceId,
          autoModeEnabled:
            true,
        });

        const updated =
          await updateTeam(
            team.id,
            {
              enabled:
                false,
            },
          );

        expect(
          updated,
        ).toMatchObject({
          enabled:
            false,
          notionDataSourceId:
            dataSourceId,
          autoModeEnabled:
            true,
        });
      },
    );

    it(
      "rejects enabled Auto Mode without an effective Notion data source",
      async () => {
        await expect(
          createTeam({
            slug:
              `invalid-automation-${crypto.randomUUID()}`,
            name:
              "Invalid Automation Team",
            description:
              "",
            enabled:
              true,
            notionDataSourceId:
              null,
            autoModeEnabled:
              true,
          }),
        ).rejects.toMatchObject({
          message:
            "A Notion data source ID is required when Auto Mode is enabled",
          statusCode:
            400,
        } satisfies Partial<TeamServiceError>);

        const team =
          await createTestTeam(
            "invalid-automation-update",
          );

        await expect(
          updateTeam(
            team.id,
            {
              autoModeEnabled:
                true,
            },
          ),
        ).rejects.toMatchObject({
          message:
            "A Notion data source ID is required when Auto Mode is enabled",
          statusCode:
            400,
        } satisfies Partial<TeamServiceError>);
      },
    );

    it(
      "rejects clearing a source while Auto Mode remains enabled",
      async () => {
        const team =
          await createTeam({
            slug:
              `source-clear-${crypto.randomUUID()}`,
            name:
              "Source Clear Team",
            description:
              "",
            enabled:
              true,
            notionDataSourceId:
              `notion-source-${crypto.randomUUID()}`,
            autoModeEnabled:
              true,
          });

        createdTeamIds.add(
          team.id,
        );

        await expect(
          updateTeam(
            team.id,
            {
              notionDataSourceId:
                null,
            },
          ),
        ).rejects.toMatchObject({
          statusCode:
            400,
        });
      },
    );

    it(
      "rejects duplicate Notion data source assignments with a stable conflict",
      async () => {
        const dataSourceId =
          `notion-source-${crypto.randomUUID()}`;

        const first =
          await createTestTeam(
            "notion-source-first",
          );

        const second =
          await createTestTeam(
            "notion-source-second",
          );

        await updateTeam(
          first.id,
          {
            notionDataSourceId:
              dataSourceId,
          },
        );

        await expect(
          updateTeam(
            second.id,
            {
              notionDataSourceId:
                dataSourceId,
            },
          ),
        ).rejects.toMatchObject({
          message:
            "That Notion data source is already assigned to another Team",
          statusCode:
            409,
        } satisfies Partial<TeamServiceError>);
      },
    );

    it(
      "rejects deletion while an Agent references the Team",
      async () => {
        const team =
          await createTestTeam(
            "agent-reference",
          );

        const [department] =
          await db
            .insert(departments)
            .values({
              slug:
                `team-agent-department-${crypto.randomUUID()}`,
              name:
                "Team Deletion Test Department",
              role:
                "Test",
              harness:
                "codex",
              defaultModel:
                "default",
              defaultReasoning:
                "high",
              systemPrompt:
                "Team deletion test.",
            })
            .returning();

        createdDepartmentIds.add(
          department.id,
        );

        await db
          .insert(agents)
          .values({
            departmentId:
              department.id,
            teamId:
              team.id,
            slug:
              `team-agent-${crypto.randomUUID()}`,
            name:
              "Referenced Agent",
            layer:
              700_001,
            executionOrder:
              1,
          });

        await expect(
          deleteTeam(
            team.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "agents",
            ),
        });
      },
    );

    it(
      "rejects deletion while a Task references the Team",
      async () => {
        const team =
          await createTestTeam(
            "task-reference",
          );

        await db
          .insert(tasks)
          .values({
            teamId:
              team.id,
            projectPath:
              "/tmp/team-task",
            title:
              "Historical task",
            instruction:
              "Preserve Team reference.",
            status:
              "completed",
          });

        await expect(
          deleteTeam(
            team.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "tasks",
            ),
        });
      },
    );

    it(
      "rejects deletion while a historical Run references the Team",
      async () => {
        const team =
          await createTestTeam(
            "run-reference",
          );

        await db
          .insert(runs)
          .values({
            teamId:
              team.id,
            projectPath:
              "/tmp/team-run",
            status:
              "completed",
          });

        await expect(
          deleteTeam(
            team.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "runs",
            ),
        });
      },
    );

    it(
      "rejects deletion while a Conversation references the Team",
      async () => {
        const team =
          await createTestTeam(
            "conversation-reference",
          );

        await db
          .insert(
            conversations,
          )
          .values({
            teamId:
              team.id,
            projectPath:
              "/tmp/team-conversation",
          });

        await expect(
          deleteTeam(
            team.id,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "conversations",
            ),
        });
      },
    );
  },
);
