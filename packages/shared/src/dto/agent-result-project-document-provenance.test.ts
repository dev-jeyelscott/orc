import {
  describe,
  expect,
  it,
} from "vitest";

import {
  agentResultSchema,
} from "./agent-result.js";

import {
  MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
} from "./project-document.js";

/**
 * Creates one minimal structured worker result with optional field overrides.
 */
function completedResult(
  overrides:
    Record<
      string,
      unknown
    > = {},
) {
  return {
    status:
      "completed",
    summary:
      "Completed the requested work.",
    ...overrides,
  };
}

/**
 * Creates one valid immutable Project Document provenance reference.
 */
function projectDocumentRef(
  index = 0,
) {
  const chunkHashCharacter =
    (
      (
        index +
        1
      ) %
      16
    ).toString(
      16,
    );

  return {
    source:
      "project_document",
    documentId:
      "00000000-0000-4000-8000-000000000001",
    fileName:
      "requirements.md",
    documentContentHash:
      "a".repeat(
        64,
      ),
    chunkSequence:
      index,
    chunkContentHash:
      chunkHashCharacter.repeat(
        64,
      ),
    heading:
      "Acceptance criteria",
  };
}

describe(
  "AgentResult Project Document provenance",
  () => {
    it(
      "preserves backward compatibility when projectDocumentRefs is omitted",
      () => {
        const result =
          agentResultSchema.parse(
            completedResult(),
          );

        expect(
          result
            .projectDocumentRefs,
        ).toBeUndefined();
      },
    );

    it(
      "accepts lightweight Project Document provenance alongside knowledgeRefs",
      () => {
        const ref =
          projectDocumentRef();

        const result =
          agentResultSchema.parse(
            completedResult({
              knowledgeRefs: [
                {
                  source:
                    "vault",
                  path:
                    "Projects/orc/Decisions/Workflow.md",
                  heading:
                    "Snapshots",
                },
              ],
              projectDocumentRefs: [
                ref,
              ],
            }),
          );

        expect(
          result
            .knowledgeRefs,
        ).toHaveLength(
          1,
        );

        expect(
          result
            .projectDocumentRefs,
        ).toEqual([
          ref,
        ]);
      },
    );

    it(
      "rejects document excerpts or other fields outside the provenance contract",
      () => {
        expect(
          agentResultSchema.safeParse(
            completedResult({
              projectDocumentRefs: [
                {
                  ...projectDocumentRef(),
                  excerpt:
                    "Document content must not be persisted as result provenance.",
                },
              ],
            }),
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects malformed immutable hashes",
      () => {
        expect(
          agentResultSchema.safeParse(
            completedResult({
              projectDocumentRefs: [
                {
                  ...projectDocumentRef(),
                  chunkContentHash:
                    "A".repeat(
                      64,
                    ),
                },
              ],
            }),
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects duplicate Project Document provenance references",
      () => {
        const ref =
          projectDocumentRef();

        expect(
          agentResultSchema.safeParse(
            completedResult({
              projectDocumentRefs: [
                ref,
                ref,
              ],
            }),
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects provenance beyond the supplied Project Document context bound",
      () => {
        expect(
          agentResultSchema.safeParse(
            completedResult({
              projectDocumentRefs:
                Array.from(
                  {
                    length:
                      MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS +
                      1,
                  },
                  (
                    _,
                    index,
                  ) =>
                    projectDocumentRef(
                      index,
                    ),
                ),
            }),
          ).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
