import {
  eq,
} from "drizzle-orm";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { db } from "../db/client.js";
import {
  RESOLUTION_TEAM_ID,
} from "../db/seed-ids.js";
import {
  domainEvents,
  projectDocumentChunks,
  projectDocuments,
  runs,
  tasks,
} from "../db/schema.js";
import {
  getRunMonitoringDetail,
  listRunMonitoringSummaries,
  projectExecutionPlan,
  projectTaskDocumentContext,
} from "./run-monitoring-service.js";

const createdRunIds =
  new Set<string>();

const createdTaskIds =
  new Set<string>();

const createdDocumentIds =
  new Set<string>();

/**
 * Creates one snapshot agent containing both public and private configuration fields.
 */
function createSnapshotAgent(
  input: {
    name:
      string;
    layer:
      number;
    executionOrder:
      number;
  },
) {
  return {
    id:
      crypto.randomUUID(),
    name:
      input.name,
    role:
      `${input.name} Role`,
    layer:
      input.layer,
    executionOrder:
      input.executionOrder,
    harness:
      "codex" as const,
    model:
      "default",
    reasoning:
      "high",
    systemPrompt:
      `Secret ${input.name} prompt`,
    canWrite:
      true,
    canRunCommands:
      true,
    canCommit:
      false,
  };
}

/**
 * Creates one persisted Run together with mutable current document rows and immutable snapshot context.
 */
async function createMonitoringRun() {
  const first =
    createSnapshotAgent({
      name:
        "First Agent",
      layer:
        1,
      executionOrder:
        1,
    });

  const second =
    createSnapshotAgent({
      name:
        "Second Agent",
      layer:
        2,
      executionOrder:
        1,
    });

  const projectPath =
    `/tmp/orc-monitoring-${crypto.randomUUID()}`;

  const documentId =
    crypto.randomUUID();

  const documentContent =
    "Original Project Document content.";

  const documentContext = {
    source:
      "project_document" as const,
    documentId,
    fileName:
      "monitoring-context.md",
    documentContentHash:
      "a".repeat(64),
    chunkSequence:
      2,
    chunkContentHash:
      "b".repeat(64),
    heading:
      "Immutable monitoring context",
    excerpt:
      "This historical worker excerpt must never be returned by Run monitoring.",
  };

  await db
    .insert(
      projectDocuments,
    )
    .values({
      id:
        documentId,
      teamId:
        RESOLUTION_TEAM_ID,
      projectPath,
      fileName:
        documentContext.fileName,
      extension:
        ".md",
      mediaType:
        "text/markdown",
      content:
        documentContent,
      contentHash:
        documentContext.documentContentHash,
      contentBytes:
        documentContent.length,
    });

  createdDocumentIds.add(
    documentId,
  );

  await db
    .insert(
      projectDocumentChunks,
    )
    .values({
      projectDocumentId:
        documentId,
      sequence:
        documentContext.chunkSequence,
      startOffset:
        0,
      endOffset:
        documentContent.length,
      content:
        documentContent,
      contentHash:
        documentContext.chunkContentHash,
    });

  const [task] =
    await db
      .insert(tasks)
      .values({
        teamId:
          RESOLUTION_TEAM_ID,
        projectPath,
        title:
          "Monitoring test task",
        instruction:
          "Validate the monitoring read model.",
        status:
          "running",
      })
      .returning();

  createdTaskIds.add(
    task.id,
  );

  const [run] =
    await db
      .insert(runs)
      .values({
        taskId:
          task.id,
        teamId:
          task.teamId,
        projectPath,
        status:
          "running",
        workflowSnapshot: {
          agents: [
            second,
            first,
          ],
          routes: [],
          taskDocumentContext: [
            documentContext,
          ],
        },
        currentAgentId:
          first.id,
        executionCount:
          1,
      })
      .returning();

  createdRunIds.add(
    run.id,
  );

  await db
    .insert(
      domainEvents,
    )
    .values({
      type:
        "run.document_context_selected",
      projectPath,
      taskId:
        task.id,
      runId:
        run.id,
      data: {
        documentIds: [
          documentId,
        ],
        chunkCount:
          1,
      },
    });

  return {
    run,
    task,
    first,
    second,
    documentContext,
  };
}

afterEach(
  async () => {
    for (
      const id of
      createdRunIds
    ) {
      await db
        .delete(
          domainEvents,
        )
        .where(
          eq(
            domainEvents.runId,
            id,
          ),
        );

      await db
        .delete(runs)
        .where(
          eq(
            runs.id,
            id,
          ),
        );
    }

    for (
      const id of
      createdDocumentIds
    ) {
      await db
        .delete(
          projectDocuments,
        )
        .where(
          eq(
            projectDocuments.id,
            id,
          ),
        );
    }

    for (
      const id of
      createdTaskIds
    ) {
      await db
        .delete(tasks)
        .where(
          eq(
            tasks.id,
            id,
          ),
        );
    }

    createdRunIds.clear();
    createdDocumentIds.clear();
    createdTaskIds.clear();
  },
);

describe(
  "run monitoring service",
  () => {
    it(
      "projects snapshot agents without exposing private configuration",
      () => {
        const agent =
          createSnapshotAgent({
            name:
              "Projection Agent",
            layer:
              2,
            executionOrder:
              3,
          });

        const plan =
          projectExecutionPlan({
            agents: [
              agent,
            ],
            routes: [],
          });

        expect(
          plan,
        ).toEqual([
          {
            id:
              agent.id,
            name:
              agent.name,
            role:
              agent.role,
            layer:
              agent.layer,
            executionOrder:
              agent.executionOrder,
            harness:
              agent.harness,
            model:
              agent.model,
            reasoning:
              agent.reasoning,
          },
        ]);

        expect(
          "systemPrompt" in
            plan[0],
        ).toBe(
          false,
        );

        expect(
          "canWrite" in
            plan[0],
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns empty projections for unavailable or malformed snapshots",
      () => {
        expect(
          projectExecutionPlan(
            null,
          ),
        ).toEqual([]);

        expect(
          projectExecutionPlan({
            agents:
              "invalid",
          }),
        ).toEqual([]);

        expect(
          projectTaskDocumentContext(
            null,
          ),
        ).toEqual([]);

        expect(
          projectTaskDocumentContext({
            taskDocumentContext:
              "invalid",
          }),
        ).toEqual([]);
      },
    );

    it(
      "joins Task metadata, Team ownership, and current snapshot Agent without adding document context to summaries",
      async () => {
        const {
          run,
          first,
        } =
          await createMonitoringRun();

        const summaries =
          await listRunMonitoringSummaries();

        const summary =
          summaries.find(
            (candidate) =>
              candidate.id ===
              run.id,
          );

        expect(
          summary,
        ).toMatchObject({
          id:
            run.id,
          teamId:
            RESOLUTION_TEAM_ID,
          taskTitle:
            "Monitoring test task",
          plannedExecutionCount:
            2,
          currentAgent: {
            id:
              first.id,
            name:
              first.name,
          },
        });

        expect(
          summary &&
            "taskDocumentContext" in
              summary,
        ).toBe(false);
      },
    );

    it(
      "adds compact immutable Project Document provenance to Team-scoped Run monitoring detail",
      async () => {
        const {
          run,
          documentContext,
        } =
          await createMonitoringRun();

        const detail =
          await getRunMonitoringDetail(
            run.id,
          );

        expect(
          detail?.run.teamId,
        ).toBe(
          RESOLUTION_TEAM_ID,
        );

        expect(
          detail?.taskDocumentContext,
        ).toEqual([
          {
            source:
              documentContext.source,
            documentId:
              documentContext.documentId,
            fileName:
              documentContext.fileName,
            documentContentHash:
              documentContext.documentContentHash,
            chunkSequence:
              documentContext.chunkSequence,
            chunkContentHash:
              documentContext.chunkContentHash,
            heading:
              documentContext.heading,
          },
        ]);

        expect(
          JSON.stringify(
            detail
              ?.taskDocumentContext,
          ),
        ).not.toContain(
          documentContext.excerpt,
        );
      },
    );

    it(
      "keeps historical provenance stable when current Project Document rows change",
      async () => {
        const {
          run,
          documentContext,
        } =
          await createMonitoringRun();

        const before =
          await getRunMonitoringDetail(
            run.id,
          );

        const mutatedDocumentContent =
          "Current Project Document state changed after the Run started.";

        await db
          .update(
            projectDocuments,
          )
          .set({
            fileName:
              "mutated-current-state.md",
            content:
              mutatedDocumentContent,
            contentHash:
              "c".repeat(64),
            contentBytes:
              mutatedDocumentContent.length,
            updatedAt:
              new Date(),
          })
          .where(
            eq(
              projectDocuments.id,
              documentContext.documentId,
            ),
          );

        await db
          .update(
            projectDocumentChunks,
          )
          .set({
            content:
              "Current chunk content changed.",
            contentHash:
              "d".repeat(64),
          })
          .where(
            eq(
              projectDocumentChunks.projectDocumentId,
              documentContext.documentId,
            ),
          );

        const after =
          await getRunMonitoringDetail(
            run.id,
          );

        expect(
          after?.taskDocumentContext,
        ).toEqual(
          before
            ?.taskDocumentContext,
        );

        expect(
          after
            ?.taskDocumentContext?.[0],
        ).toMatchObject({
          fileName:
            "monitoring-context.md",
          documentContentHash:
            "a".repeat(64),
          chunkSequence:
            2,
          chunkContentHash:
            "b".repeat(64),
        });
      },
    );

    it(
      "keeps the existing selection event lightweight while exposing exact provenance from the Run snapshot",
      async () => {
        const {
          run,
          documentContext,
        } =
          await createMonitoringRun();

        const detail =
          await getRunMonitoringDetail(
            run.id,
          );

        const event =
          detail?.events.find(
            (candidate) =>
              candidate.type ===
              "run.document_context_selected",
          );

        expect(
          event?.data,
        ).toEqual({
          documentIds: [
            documentContext.documentId,
          ],
          chunkCount:
            1,
        });

        expect(
          JSON.stringify(
            event?.data,
          ),
        ).not.toContain(
          documentContext.excerpt,
        );

        expect(
          detail
            ?.taskDocumentContext?.[0]
            ?.chunkContentHash,
        ).toBe(
          documentContext.chunkContentHash,
        );
      },
    );

    it(
      "adds the safe execution plan to existing Team-scoped Run detail",
      async () => {
        const {
          run,
        } =
          await createMonitoringRun();

        const detail =
          await getRunMonitoringDetail(
            run.id,
          );

        expect(
          detail?.executionPlan.map(
            (
              agent,
            ) =>
              agent.name,
          ),
        ).toEqual([
          "First Agent",
          "Second Agent",
        ]);

        expect(
          detail?.task?.title,
        ).toBe(
          "Monitoring test task",
        );
      },
    );
  },
);
