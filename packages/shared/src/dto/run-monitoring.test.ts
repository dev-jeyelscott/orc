import {
  describe,
  expect,
  it,
} from "vitest";

import {
  runMonitoringDetailSchema,
  runMonitoringListResponseSchema,
} from "./run-monitoring.js";

const TEAM_ID =
  "00000000-0000-4000-9000-000000000001";

const RUN_ID =
  "00000000-0000-4000-8000-000000000001";

const TASK_ID =
  "00000000-0000-4000-8000-000000000002";

const DOCUMENT_ID =
  "00000000-0000-4000-8000-000000000003";

const run = {
  id: RUN_ID,
  taskId: TASK_ID,
  teamId: TEAM_ID,
  projectPath: "/workspace/orc",
  status: "completed" as const,
  currentAgentId: null,
  executionCount: 1,
  terminalReason: null,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:05:00.000Z",
};

const provenance = {
  source: "project_document" as const,
  documentId: DOCUMENT_ID,
  fileName: "requirements.md",
  documentContentHash: "a".repeat(64),
  chunkSequence: 2,
  chunkContentHash: "b".repeat(64),
  heading: "Immutable context",
};

describe(
  "run monitoring DTOs",
  () => {
    it(
      "serializes compact Project Document provenance on detailed monitoring only",
      () => {
        const parsed =
          runMonitoringDetailSchema.parse({
            run,
            task: null,
            executions: [],
            events: [],
            executionPlan: [],
            taskDocumentContext: [
              provenance,
            ],
          });

        expect(
          parsed.taskDocumentContext,
        ).toEqual([
          provenance,
        ]);
      },
    );

    it(
      "rejects document excerpts from the monitoring provenance boundary",
      () => {
        const parsed =
          runMonitoringDetailSchema.safeParse({
            run,
            task: null,
            executions: [],
            events: [],
            executionPlan: [],
            taskDocumentContext: [
              {
                ...provenance,
                excerpt:
                  "This worker excerpt must never cross the monitoring provenance contract.",
              },
            ],
          });

        expect(
          parsed.success,
        ).toBe(false);
      },
    );

    it(
      "accepts older detail payloads without Project Document provenance",
      () => {
        const parsed =
          runMonitoringDetailSchema.parse({
            run,
            task: null,
            executions: [],
            events: [],
            executionPlan: [],
          });

        expect(
          parsed.taskDocumentContext,
        ).toBeUndefined();
      },
    );

    it(
      "keeps monitoring list responses free of detailed document context",
      () => {
        const parsed =
          runMonitoringListResponseSchema.parse({
            runs: [
              {
                ...run,
                taskTitle:
                  "Inspect immutable context",
                plannedExecutionCount:
                  1,
                currentAgent:
                  null,
                taskDocumentContext: [
                  provenance,
                ],
              },
            ],
          });

        expect(
          "taskDocumentContext" in
            parsed.runs[0],
        ).toBe(false);
      },
    );
  },
);
