import {
  describe,
  expect,
  it,
} from "vitest";

import {
  agentResultSchema,
} from "./agent-result.js";

import {
  MAX_KNOWLEDGE_EXCERPT_CHARS,
  MAX_KNOWLEDGE_REFS,
} from "./knowledge.js";

/**
 * Creates one minimal completed result for provenance validation.
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

describe(
  "AgentResult knowledge provenance",
  () => {
    it(
      "preserves compatibility when knowledgeRefs is omitted",
      () => {
        const result =
          agentResultSchema.parse(
            completedResult(),
          );

        expect(
          result
            .knowledgeRefs,
        ).toBeUndefined();
      },
    );

    it(
      "accepts lightweight durable provenance",
      () => {
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
            }),
          );

        expect(
          result
            .knowledgeRefs,
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "rejects too many refs and oversized excerpts",
      () => {
        expect(
          agentResultSchema.safeParse(
            completedResult({
              knowledgeRefs:
                Array.from(
                  {
                    length:
                      MAX_KNOWLEDGE_REFS +
                      1,
                  },
                  (
                    _,
                    index,
                  ) => ({
                    source:
                      "vault",
                    path:
                      `Projects/orc/Decisions/${index}.md`,
                  }),
                ),
            }),
          ).success,
        ).toBe(
          false,
        );

        expect(
          agentResultSchema.safeParse(
            completedResult({
              knowledgeRefs: [
                {
                  source:
                    "vault",
                  path:
                    "Projects/orc/Overview.md",
                  excerpt:
                    "x".repeat(
                      MAX_KNOWLEDGE_EXCERPT_CHARS +
                      1,
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
  },
);
