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
  agents,
  conversations,
  departments,
  runs,
  tasks,
  teamMembers,
  teams,
} from "../db/schema.js";
import {
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

const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-team-service-test-"));
  createdRoots.push(root);
  return root;
}

/**
 * Creates and tracks one disposable Team.
 */
async function createTestTeam(
  root: string,
  label: string,
) {
  const team =
    await createTeam(
      {
        slug:
          `team-service-${label}-${crypto.randomUUID()}`,
        name:
          `Team Service ${label}`,
        description:
          "",
        enabled:
          true,
      },
      root,
    );

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

    const members =
      await db
        .delete(teamMembers)
        .where(
          eq(
            teamMembers.teamId,
            teamId,
          ),
        )
        .returning({
          agentId:
            teamMembers.agentId,
        });

    for (
      const member of
      members
    ) {
      await db
        .delete(agents)
        .where(
          eq(
            agents.id,
            member.agentId,
          ),
        );
    }

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

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
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
        const root = await makeConfigRoot();
        const team =
          await createTestTeam(
            root,
            "crud",
          );

        expect(
          await getTeam(
            team.id,
            root,
          ),
        ).toMatchObject({
          id:
            team.id,
          enabled:
            true,
        });

        expect(
          (
            await listTeams(root)
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
            team.configRevision,
            root,
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
            updated!.configRevision,
            root,
          ),
        ).toBe(true);

        createdTeamIds.delete(
          team.id,
        );

        expect(
          await getTeam(
            team.id,
            root,
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects duplicate Team slugs",
      async () => {
        const root = await makeConfigRoot();
        const slug =
          `duplicate-${crypto.randomUUID()}`;

        const first =
          await createTeam(
            {
              slug,
              name:
                "First Duplicate",
              description:
                "",
              enabled:
                true,
            },
            root,
          );

        createdTeamIds.add(
          first.id,
        );

        await expect(
          createTeam(
            {
              slug,
              name:
                "Second Duplicate",
              description:
                "",
              enabled:
                true,
            },
            root,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
        });
      },
    );

    it(
      "rejects an update against a stale configRevision",
      async () => {
        const root = await makeConfigRoot();
        const team = await createTestTeam(root, "stale");

        await expect(
          updateTeam(
            team.id,
            { enabled: false },
            "not-the-current-revision",
            root,
          ),
        ).rejects.toMatchObject({ statusCode: 409 });
      },
    );

    it(
      "rejects deletion while an Agent references the Team",
      async () => {
        const root = await makeConfigRoot();
        const team =
          await createTestTeam(
            root,
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

        const [agent] =
          await db
            .insert(agents)
            .values({
              departmentId:
                department.id,
              slug:
                `team-agent-${crypto.randomUUID()}`,
              name:
                "Referenced Agent",
            })
            .returning();

        await db
          .insert(teamMembers)
          .values({
            teamId:
              team.id,
            departmentId:
              department.id,
            agentId:
              agent.id,
            layer:
              700_001,
            executionOrder:
              1,
          });

        await expect(
          deleteTeam(
            team.id,
            null,
            root,
          ),
        ).rejects.toMatchObject({
          statusCode:
            409,
          message:
            expect.stringContaining(
              "workflow members",
            ),
        });
      },
    );

    it(
      "rejects deletion while a Task references the Team",
      async () => {
        const root = await makeConfigRoot();
        const team =
          await createTestTeam(
            root,
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
            null,
            root,
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
        const root = await makeConfigRoot();
        const team =
          await createTestTeam(
            root,
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
            null,
            root,
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
        const root = await makeConfigRoot();
        const team =
          await createTestTeam(
            root,
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
            null,
            root,
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
