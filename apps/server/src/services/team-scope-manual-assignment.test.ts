import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Project,
} from "@orc/shared";

const mocks =
  vi.hoisted(
    () => ({
      getProject:
        vi.fn(),
      getProjectByPath:
        vi.fn(),
    }),
  );

vi.mock(
  "./project-discovery.js",
  () => ({
    getProject:
      mocks.getProject,
    getProjectByPath:
      mocks.getProjectByPath,
  }),
);

import {
  db,
} from "../db/client.js";
import {
  DEVELOPMENT_ARCHITECT_AGENT_ID,
  DEVELOPMENT_TEAM_ID,
} from "../db/seed-ids.js";
import {
  agents,
  tasks,
  teams,
} from "../db/schema.js";
import {
  createTask,
} from "./workflow-service.js";

const project: Project = {
  id:
    "development-manual-assignment-test",
  name:
    "orc",
  path:
    `/tmp/orc-development-manual-${crypto.randomUUID()}`,
  branch:
    "main",
  gitState:
    "clean",
  primaryFiles: [
    "package.json",
  ],
  packageManager:
    "pnpm",
  stack:
    "node",
};

let createdTaskId:
  string | null =
    null;

let originalAgentEnabled:
  boolean | null =
    null;

let originalTeamEnabled:
  boolean | null =
    null;

beforeEach(
  async () => {
    mocks.getProject
      .mockReset();

    mocks.getProjectByPath
      .mockReset();

    mocks.getProject
      .mockResolvedValue(
        project,
      );

    mocks.getProjectByPath
      .mockResolvedValue(
        project,
      );

    const [developmentAgent] =
      await db
        .select({
          enabled:
            agents.enabled,
        })
        .from(agents)
        .where(
          eq(
            agents.id,
            DEVELOPMENT_ARCHITECT_AGENT_ID,
          ),
        );

    const [developmentTeam] =
      await db
        .select({
          enabled:
            teams.enabled,
        })
        .from(teams)
        .where(
          eq(
            teams.id,
            DEVELOPMENT_TEAM_ID,
          ),
        );

    if (
      !developmentAgent ||
      !developmentTeam
    ) {
      throw new Error(
        "Development Team seed fixtures are missing",
      );
    }

    originalAgentEnabled =
      developmentAgent.enabled;

    originalTeamEnabled =
      developmentTeam.enabled;

    await db
      .update(teams)
      .set({
        enabled:
          true,
      })
      .where(
        eq(
          teams.id,
          DEVELOPMENT_TEAM_ID,
        ),
      );

    await db
      .update(agents)
      .set({
        enabled:
          true,
      })
      .where(
        eq(
          agents.id,
          DEVELOPMENT_ARCHITECT_AGENT_ID,
        ),
      );
  },
);

afterEach(
  async () => {
    if (
      createdTaskId
    ) {
      await db
        .delete(tasks)
        .where(
          eq(
            tasks.id,
            createdTaskId,
          ),
        );
    }

    if (
      originalAgentEnabled !==
      null
    ) {
      await db
        .update(agents)
        .set({
          enabled:
            originalAgentEnabled,
        })
        .where(
          eq(
            agents.id,
            DEVELOPMENT_ARCHITECT_AGENT_ID,
          ),
        );
    }

    if (
      originalTeamEnabled !==
      null
    ) {
      await db
        .update(teams)
        .set({
          enabled:
            originalTeamEnabled,
        })
        .where(
          eq(
            teams.id,
            DEVELOPMENT_TEAM_ID,
          ),
        );
    }

    createdTaskId =
      null;

    originalAgentEnabled =
      null;

    originalTeamEnabled =
      null;
  },
);

describe(
  "Development manual Task assignment",
  () => {
    it(
      "persists an explicitly selected Development Team on a manual Task",
      async () => {
        const created =
          await createTask({
            projectId:
              project.id,
            teamId:
              DEVELOPMENT_TEAM_ID,
            title:
              "Development manual task",
            instruction:
              "Validate explicit manual Team assignment.",
          });

        createdTaskId =
          created.id;

        expect(
          created,
        ).toMatchObject({
          teamId:
            DEVELOPMENT_TEAM_ID,
          source:
            "manual",
          status:
            "pending",
        });

        const [persisted] =
          await db
            .select()
            .from(tasks)
            .where(
              eq(
                tasks.id,
                created.id,
              ),
            );

        expect(
          persisted,
        ).toMatchObject({
          id:
            created.id,
          teamId:
            DEVELOPMENT_TEAM_ID,
          source:
            "manual",
          status:
            "pending",
        });
      },
    );
  },
);
