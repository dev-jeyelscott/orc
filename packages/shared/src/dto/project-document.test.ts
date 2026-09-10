import {
  describe,
  expect,
  it,
} from "vitest";

import {
  knowledgeRefSchema,
} from "./knowledge.js";

import {
  createProjectDocumentRequestSchema,
  MAX_PROJECT_DOCUMENT_CONTEXT_CHARS,
  MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
  MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
  MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
  projectDocumentChunkMetadataSchema,
  projectDocumentCreateResponseSchema,
  projectDocumentListResponseSchema,
  projectDocumentMetadataSchema,
  projectDocumentUploadMetadataSchema,
  uploadedProjectDocumentContextCollectionSchema,
  uploadedProjectDocumentContextRefSchema,
} from "./project-document.js";

const DOCUMENT_ID =
  "11111111-1111-4111-8111-111111111111";

const TEAM_ID =
  "22222222-2222-4222-8222-222222222222";

const DOCUMENT_HASH =
  "a".repeat(
    64,
  );

const CHUNK_HASH =
  "b".repeat(
    64,
  );

describe(
  "project document contracts",
  () => {
    /**
     * Verifies canonical Markdown and plain-text upload metadata are accepted.
     */
    it(
      "accepts supported bounded upload metadata",
      () => {
        expect(
          projectDocumentUploadMetadataSchema.parse({
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            sizeBytes:
              4_096,
          }),
        ).toEqual({
          fileName:
            "roadmap.md",
          extension:
            ".md",
          mediaType:
            "text/markdown",
          sizeBytes:
            4_096,
        });

        expect(
          projectDocumentUploadMetadataSchema.safeParse({
            fileName:
              "notes.txt",
            extension:
              ".txt",
            mediaType:
              "text/plain",
            sizeBytes:
              512,
          }).success,
        ).toBe(
          true,
        );
      },
    );

    /**
     * Verifies unsupported extensions, mismatched media types, paths, and excessive upload sizes are rejected.
     */
    it(
      "rejects unsupported or unsafe upload metadata",
      () => {
        expect(
          projectDocumentUploadMetadataSchema.safeParse({
            fileName:
              "roadmap.pdf",
            extension:
              ".pdf",
            mediaType:
              "application/pdf",
            sizeBytes:
              100,
          }).success,
        ).toBe(
          false,
        );

        expect(
          projectDocumentUploadMetadataSchema.safeParse({
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/plain",
            sizeBytes:
              100,
          }).success,
        ).toBe(
          false,
        );

        expect(
          projectDocumentUploadMetadataSchema.safeParse({
            fileName:
              "../roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            sizeBytes:
              100,
          }).success,
        ).toBe(
          false,
        );

        expect(
          projectDocumentUploadMetadataSchema.safeParse({
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            sizeBytes:
              MAX_PROJECT_DOCUMENT_UPLOAD_BYTES +
              1,
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies persisted document metadata remains bounded without exposing the document body.
     */
    it(
      "accepts persisted project document metadata",
      () => {
        const parsed =
          projectDocumentMetadataSchema.parse({
            id:
              DOCUMENT_ID,
            teamId:
              TEAM_ID,
            projectPath:
              "/home/user/workspace/orc",
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            contentHash:
              DOCUMENT_HASH,
            contentBytes:
              3_000,
            createdAt:
              "2026-09-09T00:00:00.000Z",
            updatedAt:
              "2026-09-09T00:00:00.000Z",
          });

        expect(
          parsed.id,
        ).toBe(
          DOCUMENT_ID,
        );

        expect(
          parsed.contentHash,
        ).toBe(
          DOCUMENT_HASH,
        );

        expect(
          "content" in
            parsed,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies deterministic chunk metadata requires ordered non-overturned offsets.
     */
    it(
      "validates deterministic chunk metadata",
      () => {
        expect(
          projectDocumentChunkMetadataSchema.safeParse({
            documentId:
              DOCUMENT_ID,
            sequence:
              0,
            startOffset:
              0,
            endOffset:
              500,
            contentHash:
              CHUNK_HASH,
          }).success,
        ).toBe(
          true,
        );

        expect(
          projectDocumentChunkMetadataSchema.safeParse({
            documentId:
              DOCUMENT_ID,
            sequence:
              0,
            startOffset:
              500,
            endOffset:
              500,
            contentHash:
              CHUNK_HASH,
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies one uploaded-document context reference enforces the per-item excerpt ceiling.
     */
    it(
      "enforces uploaded document context item bounds",
      () => {
        expect(
          uploadedProjectDocumentContextRefSchema.safeParse({
            source:
              "project_document",
            documentId:
              DOCUMENT_ID,
            fileName:
              "roadmap.md",
            documentContentHash:
              DOCUMENT_HASH,
            chunkSequence:
              0,
            chunkContentHash:
              CHUNK_HASH,
            excerpt:
              "x".repeat(
                MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
              ),
          }).success,
        ).toBe(
          true,
        );

        expect(
          uploadedProjectDocumentContextRefSchema.safeParse({
            source:
              "project_document",
            documentId:
              DOCUMENT_ID,
            fileName:
              "roadmap.md",
            documentContentHash:
              DOCUMENT_HASH,
            chunkSequence:
              0,
            chunkContentHash:
              CHUNK_HASH,
            excerpt:
              "x".repeat(
                MAX_PROJECT_DOCUMENT_EXCERPT_CHARS +
                1,
              ),
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies uploaded-document context enforces both collection count and aggregate excerpt budgets.
     */
    it(
      "enforces uploaded document context collection bounds",
      () => {
        const withinLimit =
          Array.from(
            {
              length:
                MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
            },
            (
              _,
              index,
            ) => ({
              source:
                "project_document" as const,
              documentId:
                DOCUMENT_ID,
              fileName:
                "roadmap.md",
              documentContentHash:
                DOCUMENT_HASH,
              chunkSequence:
                index,
              chunkContentHash:
                index
                  .toString(
                    16,
                  )
                  .padStart(
                    64,
                    "0",
                  ),
              excerpt:
                "x",
            }),
          );

        expect(
          uploadedProjectDocumentContextCollectionSchema.safeParse(
            withinLimit,
          ).success,
        ).toBe(
          true,
        );

        expect(
          uploadedProjectDocumentContextCollectionSchema.safeParse([
            ...withinLimit,
            {
              source:
                "project_document",
              documentId:
                DOCUMENT_ID,
              fileName:
                "roadmap.md",
              documentContentHash:
                DOCUMENT_HASH,
              chunkSequence:
                MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
              chunkContentHash:
                "f".repeat(
                  64,
                ),
              excerpt:
                "x",
            },
          ]).success,
        ).toBe(
          false,
        );

        const aggregateOverflow =
          Array.from(
            {
              length:
                MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
            },
            (
              _,
              index,
            ) => ({
              source:
                "project_document" as const,
              documentId:
                DOCUMENT_ID,
              fileName:
                "roadmap.md",
              documentContentHash:
                DOCUMENT_HASH,
              chunkSequence:
                index,
              chunkContentHash:
                index
                  .toString(
                    16,
                  )
                  .padStart(
                    64,
                    "0",
                  ),
              excerpt:
                "x".repeat(
                  Math.floor(
                    MAX_PROJECT_DOCUMENT_CONTEXT_CHARS /
                      MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
                  ) +
                    1,
                ),
            }),
          );

        expect(
          uploadedProjectDocumentContextCollectionSchema.safeParse(
            aggregateOverflow,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies uploaded Project documents do not broaden or replace the existing vault KnowledgeRef provenance contract.
     */
    it(
      "keeps uploaded document and vault provenance distinct",
      () => {
        expect(
          knowledgeRefSchema.safeParse({
            source:
              "vault",
            path:
              "Projects/orc/README.md",
            excerpt:
              "Vault context.",
          }).success,
        ).toBe(
          true,
        );

        expect(
          knowledgeRefSchema.safeParse({
            source:
              "project_document",
            path:
              "roadmap.md",
          }).success,
        ).toBe(
          false,
        );

        expect(
          uploadedProjectDocumentContextRefSchema.safeParse({
            source:
              "vault",
            documentId:
              DOCUMENT_ID,
            fileName:
              "roadmap.md",
            documentContentHash:
              DOCUMENT_HASH,
            chunkSequence:
              0,
            chunkContentHash:
              CHUNK_HASH,
            excerpt:
              "Wrong provenance.",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies a well-formed create request is accepted and mismatched file metadata is rejected.
     */
    it(
      "validates create requests against file metadata agreement",
      () => {
        expect(
          createProjectDocumentRequestSchema.safeParse({
            teamId:
              TEAM_ID,
            projectPath:
              "/tmp/orc-test-project",
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            content:
              "# Roadmap",
          }).success,
        ).toBe(
          true,
        );

        expect(
          createProjectDocumentRequestSchema.safeParse({
            teamId:
              TEAM_ID,
            projectPath:
              "/tmp/orc-test-project",
            fileName:
              "roadmap.txt",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            content:
              "# Roadmap",
          }).success,
        ).toBe(
          false,
        );

        expect(
          createProjectDocumentRequestSchema.safeParse({
            teamId:
              TEAM_ID,
            projectPath:
              "/tmp/orc-test-project",
            fileName:
              "roadmap.md",
            extension:
              ".md",
            mediaType:
              "text/markdown",
            content:
              "",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    /**
     * Verifies list and create responses only ever carry document metadata, never chunk bodies.
     */
    it(
      "keeps list and create responses free of chunk content",
      () => {
        const document =
          {
            id:
              DOCUMENT_ID,
            teamId:
              TEAM_ID,
            projectPath:
              "/tmp/orc-test-project",
            fileName:
              "roadmap.md",
            extension:
              ".md" as const,
            mediaType:
              "text/markdown" as const,
            contentHash:
              DOCUMENT_HASH,
            contentBytes:
              10,
            createdAt:
              new Date().toISOString(),
            updatedAt:
              new Date().toISOString(),
          };

        const listParsed =
          projectDocumentListResponseSchema.safeParse({
            documents: [
              document,
            ],
          });

        expect(
          listParsed.success,
        ).toBe(
          true,
        );

        const createParsed =
          projectDocumentCreateResponseSchema.safeParse({
            document,
            chunkCount:
              3,
          });

        expect(
          createParsed.success,
        ).toBe(
          true,
        );

        expect(
          projectDocumentCreateResponseSchema.safeParse({
            document: {
              ...document,
              chunks: [
                "should not be accepted",
              ],
            },
            chunkCount:
              3,
          }).success,
        ).toBe(
          false,
        );
      },
    );
  },
);
