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
  runs,
  tasks,
  teams,
} from "../db/schema.js";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "./team-service.js";

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

  createdTeamIds.clear();
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
      "rejects deletion while an Agent references the Team",
      async () => {
        const team =
          await createTestTeam(
            "agent-reference",
          );

        await db
          .insert(agents)
          .values({
            teamId:
              team.id,
            slug:
              `team-agent-${crypto.randomUUID()}`,
            name:
              "Referenced Agent",
            role:
              "Test",
            layer:
              700_001,
            executionOrder:
              1,
            harness:
              "codex",
            model:
              "default",
            reasoning:
              "high",
            systemPrompt:
              "Team deletion test.",
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
