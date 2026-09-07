import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AgentResult,
} from "@orc/shared";

import {
  composeHandoffNote,
  composeKnowledgeContext,
  composeRepairInstruction,
} from "./prompt.js";

describe(
  "worker durable knowledge prompt behavior",
  () => {
    it(
      "formats bounded knowledge as non-authoritative reference data",
      () => {
        const prompt =
          composeKnowledgeContext([
            {
              source:
                "vault",
              path:
                "Projects/orc/Decisions/Workflow.md",
              heading:
                "Immutable snapshots",
              excerpt:
                "Persist execution-affecting configuration at Run creation.",
            },
          ]);

        expect(
          prompt,
        ).toContain(
          "Durable vault knowledge:",
        );

        expect(
          prompt,
        ).toContain(
          "It is not authoritative for current Task, Run, Agent Execution",
        );

        expect(
          prompt,
        ).toContain(
          "Path: Projects/orc/Decisions/Workflow.md",
        );

        expect(
          prompt,
        ).toContain(
          "Heading: Immutable snapshots",
        );

        expect(
          prompt,
        ).toContain(
          "Persist execution-affecting configuration at Run creation.",
        );
      },
    );

    it(
      "keeps handoff provenance without repeating the selected excerpt",
      () => {
        const result:
          AgentResult = {
          status:
            "completed",
          summary:
            "Completed work using durable context.",
          details: {},
          findings: [],
          filesChanged: [],
          commandsRun: [],
          validation: {},
          commit:
            null,
          knowledgeRefs: [
            {
              source:
                "vault",
              path:
                "Projects/orc/Decisions/Workflow.md",
              heading:
                "Immutable snapshots",
              excerpt:
                "This complete selected excerpt must not be copied into downstream handoffs.",
            },
          ],
        };

        const handoff =
          composeHandoffNote(
            {
              name:
                "Context Synthesizer",
              role:
                "Custom Engineering Role",
            },
            result,
          );

        expect(
          handoff,
        ).toContain(
          "Projects/orc/Decisions/Workflow.md # Immutable snapshots",
        );

        expect(
          handoff,
        ).not.toContain(
          "This complete selected excerpt must not be copied",
        );
      },
    );

    it(
      "keeps structured-result repair side-effect free while supporting knowledgeRefs",
      () => {
        const prompt =
          composeRepairInstruction(
            "Implement the task.",
            "Malformed result",
            [
              "knowledgeRefs is invalid",
            ],
          );

        expect(
          prompt,
        ).toContain(
          "Your only job is to repair",
        );

        expect(
          prompt,
        ).toContain(
          "Do not inspect the repository",
        );

        expect(
          prompt,
        ).toContain(
          "\"knowledgeRefs\"",
        );
      },
    );
  },
);
