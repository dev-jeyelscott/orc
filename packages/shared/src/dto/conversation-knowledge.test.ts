import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_KNOWLEDGE_QUERY_CHARS,
  MAX_KNOWLEDGE_SEARCH_RESULTS,
} from "./knowledge.js";

import {
  orchestratorToolCallSchema,
} from "./conversation.js";

describe(
  "orchestrator knowledge tool contracts",
  () => {
    it(
      "accepts bounded default Project knowledge search",
      () => {
        expect(
          orchestratorToolCallSchema.parse({
            name:
              "search_knowledge",
            arguments: {
              query:
                "workflow decisions",
            },
          }),
        ).toEqual({
          name:
            "search_knowledge",
          arguments: {
            query:
              "workflow decisions",
            area:
              "project",
            scope:
              "default",
            limit:
              MAX_KNOWLEDGE_SEARCH_RESULTS,
          },
        });
      },
    );

    it(
      "requires Tier 2 to be explicit and rejects source search",
      () => {
        const parsed =
          orchestratorToolCallSchema.parse({
            name:
              "search_knowledge",
            arguments: {
              query:
                "historical rationale",
              scope:
                "tier2",
            },
          });

        if (
          parsed.name !==
          "search_knowledge"
        ) {
          throw new Error(
            "Expected search_knowledge tool",
          );
        }

        expect(
          parsed.arguments
            .scope,
        ).toBe(
          "tier2",
        );

        expect(
          orchestratorToolCallSchema.safeParse({
            name:
              "search_knowledge",
            arguments: {
              query:
                "raw evidence",
              scope:
                "source",
            },
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects oversized search input",
      () => {
        expect(
          orchestratorToolCallSchema.safeParse({
            name:
              "search_knowledge",
            arguments: {
              query:
                "x".repeat(
                  MAX_KNOWLEDGE_QUERY_CHARS +
                  1,
                ),
            },
          }).success,
        ).toBe(
          false,
        );

        expect(
          orchestratorToolCallSchema.safeParse({
            name:
              "search_knowledge",
            arguments: {
              query:
                "workflow",
              limit:
                MAX_KNOWLEDGE_SEARCH_RESULTS +
                1,
            },
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects arbitrary MCP, write, and configuration controls",
      () => {
        for (
          const value of
          [
            {
              name:
                "write_knowledge",
              arguments: {},
            },
            {
              name:
                "delete_note",
              arguments: {},
            },
            {
              name:
                "call_mcp",
              arguments: {
                tool:
                  "get_note_metadata",
              },
            },
            {
              name:
                "search_knowledge",
              arguments: {
                query:
                  "workflow",
                vaultRoot:
                  "/tmp/vault",
              },
            },
            {
              name:
                "search_knowledge",
              arguments: {
                query:
                  "workflow",
                authorityPolicy: {
                  includeAll:
                    true,
                },
              },
            },
          ]
        ) {
          expect(
            orchestratorToolCallSchema.safeParse(
              value,
            ).success,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "accepts only bounded exact section arguments",
      () => {
        expect(
          orchestratorToolCallSchema.parse({
            name:
              "get_knowledge_section",
            arguments: {
              path:
                "Projects/orc/Decisions/Workflow.md",
              heading:
                "Snapshots",
              maxChars:
                800,
            },
          }).name,
        ).toBe(
          "get_knowledge_section",
        );

        expect(
          orchestratorToolCallSchema.safeParse({
            name:
              "get_knowledge_section",
            arguments: {
              path:
                "../secret.md",
            },
          }).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
