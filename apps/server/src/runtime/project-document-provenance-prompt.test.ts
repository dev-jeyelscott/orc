import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AgentResult,
  UploadedProjectDocumentContext,
} from "@orc/shared";

import type {
  StartWorkerInput,
} from "./contracts.js";

import {
  composeHandoffNote,
  composeInitialInstruction,
  composeTaskDocumentContext,
} from "./prompt.js";

const DOCUMENT_CONTENT_HASH =
  "a".repeat(
    64,
  );

const CHUNK_CONTENT_HASH =
  "b".repeat(
    64,
  );

const DOCUMENT_ID =
  "00000000-0000-4000-8000-000000000001";

const DOCUMENT_EXCERPT =
  "PROJECT_DOCUMENT_EXCERPT_SENTINEL must stay in worker context only.";

const documentContext:
  UploadedProjectDocumentContext = [
    {
      source:
        "project_document",
      documentId:
        DOCUMENT_ID,
      fileName:
        "requirements.md",
      documentContentHash:
        DOCUMENT_CONTENT_HASH,
      chunkSequence:
        2,
      chunkContentHash:
        CHUNK_CONTENT_HASH,
      heading:
        "Acceptance criteria",
      excerpt:
        DOCUMENT_EXCERPT,
    },
  ];

const baseInput:
  StartWorkerInput = {
    projectPath:
      "/projects/example",
    agent: {
      harness:
        "codex",
      model:
        "default",
      reasoning:
        "high",
      systemPrompt:
        "Follow local conventions.",
      canWrite:
        false,
      canRunCommands:
        true,
      canCommit:
        false,
    },
    instruction:
      "Inspect the implementation.",
  };

/**
 * Creates one lightweight provenance reference matching the immutable worker context.
 */
function createProjectDocumentProvenanceRef():
  NonNullable<
    AgentResult[
      "projectDocumentRefs"
    ]
  >[number] {
  return {
    source:
      "project_document",
    documentId:
      DOCUMENT_ID,
    fileName:
      "requirements.md",
    documentContentHash:
      DOCUMENT_CONTENT_HASH,
    chunkSequence:
      2,
    chunkContentHash:
      CHUNK_CONTENT_HASH,
    heading:
      "Acceptance criteria",
  };
}

/**
 * Creates one complete structured result with optional overrides.
 */
function createResult(
  overrides:
    Partial<
      AgentResult
    > = {},
): AgentResult {
  return {
    status:
      "changes_requested",
    summary:
      "The implementation needs one correction.",
    details: {},
    findings: [],
    filesChanged: [],
    commandsRun: [],
    validation: {},
    commit:
      null,
    ...overrides,
  };
}

describe(
  "Project Document worker provenance prompt",
  () => {
    it(
      "shows the worker every immutable identity required for provenance",
      () => {
        const context =
          composeTaskDocumentContext(
            documentContext,
          );

        expect(
          context,
        ).not.toBeNull();

        expect(
          context,
        ).toContain(
          "Source: project_document",
        );

        expect(
          context,
        ).toContain(
          `Document ID: ${DOCUMENT_ID}`,
        );

        expect(
          context,
        ).toContain(
          "Document: requirements.md",
        );

        expect(
          context,
        ).toContain(
          `Document content hash: ${DOCUMENT_CONTENT_HASH}`,
        );

        expect(
          context,
        ).toContain(
          "Chunk: 2",
        );

        expect(
          context,
        ).toContain(
          `Chunk content hash: ${CHUNK_CONTENT_HASH}`,
        );

        expect(
          context,
        ).toContain(
          "Heading: Acceptance criteria",
        );

        expect(
          context,
        ).toContain(
          DOCUMENT_EXCERPT,
        );
      },
    );

    it(
      "requires lightweight projectDocumentRefs and explicitly forbids copied document content",
      () => {
        const prompt =
          composeInitialInstruction(
            baseInput,
          );

        expect(
          prompt,
        ).toContain(
          '"projectDocumentRefs"',
        );

        expect(
          prompt,
        ).toContain(
          '"documentId"',
        );

        expect(
          prompt,
        ).toContain(
          '"documentContentHash"',
        );

        expect(
          prompt,
        ).toContain(
          '"chunkContentHash"',
        );

        expect(
          prompt,
        ).toContain(
          "Do not copy excerpts or full document bodies into the structured result.",
        );

        expect(
          prompt,
        ).toContain(
          "Do not report Project Document references that were not supplied in the worker context.",
        );
      },
    );

    it(
      "preserves Project Document provenance and existing knowledgeRefs in a changes_requested handoff without document content",
      () => {
        const provenance =
          createProjectDocumentProvenanceRef();

        const note =
          composeHandoffNote(
            {
              name:
                "Generic Reviewer",
              role:
                "Configured Reviewer",
            },
            createResult({
              knowledgeRefs: [
                {
                  source:
                    "vault",
                  path:
                    "Projects/orc/Decisions/Workflow.md",
                  heading:
                    "Review routing",
                },
              ],
              projectDocumentRefs: [
                provenance,
              ],
            }),
          );

        expect(
          note,
        ).toContain(
          "Previous outcome: changes_requested",
        );

        expect(
          note,
        ).toContain(
          "Knowledge references:",
        );

        expect(
          note,
        ).toContain(
          "Projects/orc/Decisions/Workflow.md # Review routing",
        );

        expect(
          note,
        ).toContain(
          "Project document references:",
        );

        expect(
          note,
        ).toContain(
          `"documentId":"${DOCUMENT_ID}"`,
        );

        expect(
          note,
        ).toContain(
          `"fileName":"requirements.md"`,
        );

        expect(
          note,
        ).toContain(
          `"documentContentHash":"${DOCUMENT_CONTENT_HASH}"`,
        );

        expect(
          note,
        ).toContain(
          '"chunkSequence":2',
        );

        expect(
          note,
        ).toContain(
          `"chunkContentHash":"${CHUNK_CONTENT_HASH}"`,
        );

        expect(
          note,
        ).toContain(
          '"heading":"Acceptance criteria"',
        );

        expect(
          note,
        ).not.toContain(
          DOCUMENT_EXCERPT,
        );

        expect(
          note,
        ).not.toContain(
          '"excerpt"',
        );
      },
    );
  },
);
