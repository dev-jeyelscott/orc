import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_KNOWLEDGE_CONTEXT_CHARS,
  MAX_KNOWLEDGE_EXCERPT_CHARS,
  MAX_KNOWLEDGE_REFS,
  knowledgeRefCollectionSchema,
  knowledgeRefSchema,
  knowledgeSectionRequestSchema,
} from "./knowledge.js";

/**
 * Creates one bounded durable vault reference for contract assertions.
 */
function knowledgeRef(
  index:
    number,
) {
  return {
    source:
      "vault" as const,
    path:
      `Projects/orc/Decisions/Decision-${index}.md`,
    heading:
      "Architecture",
  };
}

describe(
  "knowledge contracts",
  () => {
    it(
      "accepts a normalized bounded durable vault reference",
      () => {
        expect(
          knowledgeRefSchema.parse({
            source:
              "vault",
            path:
              "Projects/orc/Decisions/Workflow.md",
            heading:
              "Immutable workflow snapshots",
            excerpt:
              "Persist execution-affecting configuration when the Run begins.",
          }),
        ).toMatchObject({
          source:
            "vault",
          path:
            "Projects/orc/Decisions/Workflow.md",
        });
      },
    );

    it.each([
      "/absolute/note.md",
      "C:/vault/note.md",
      "../note.md",
      "Projects/orc/../secret.md",
      "Projects//orc/note.md",
      "Projects\\orc\\note.md",
      "./Projects/orc/note.md",
    ])(
      "rejects unsafe vault path %s",
      (
        path,
      ) => {
        expect(
          knowledgeRefSchema.safeParse({
            source:
              "vault",
            path,
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects non-vault provenance",
      () => {
        expect(
          knowledgeRefSchema.safeParse({
            source:
              "web",
            path:
              "Projects/orc/Overview.md",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "enforces reference count and aggregate excerpt budgets",
      () => {
        expect(
          knowledgeRefCollectionSchema.safeParse(
            Array.from(
              {
                length:
                  MAX_KNOWLEDGE_REFS +
                  1,
              },
              (
                _,
                index,
              ) =>
                knowledgeRef(
                  index,
                ),
            ),
          ).success,
        ).toBe(
          false,
        );

        expect(
          knowledgeRefCollectionSchema.safeParse([
            {
              ...knowledgeRef(
                1,
              ),
              excerpt:
                "x".repeat(
                  MAX_KNOWLEDGE_CONTEXT_CHARS,
                ),
            },
            {
              ...knowledgeRef(
                2,
              ),
              excerpt:
                "x",
            },
          ]).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "enforces the consumer section excerpt ceiling",
      () => {
        expect(
          knowledgeSectionRequestSchema.safeParse({
            path:
              "Projects/orc/Overview.md",
            maxChars:
              MAX_KNOWLEDGE_EXCERPT_CHARS +
              1,
          }).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
