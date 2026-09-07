import { z } from "zod";

export const MAX_KNOWLEDGE_REFS =
  5;

export const MAX_KNOWLEDGE_PATH_CHARS =
  1_024;

export const MAX_KNOWLEDGE_HEADING_CHARS =
  300;

export const MAX_KNOWLEDGE_EXCERPT_CHARS =
  1_200;

export const MAX_KNOWLEDGE_CONTEXT_CHARS =
  5_000;

export const MAX_KNOWLEDGE_SEARCH_RESULTS =
  5;

export const MAX_KNOWLEDGE_QUERY_CHARS =
  300;

export const MAX_KNOWLEDGE_TITLE_CHARS =
  240;

export const MAX_KNOWLEDGE_METADATA_VALUES =
  5;

export const MAX_KNOWLEDGE_METADATA_VALUE_CHARS =
  120;

export const MAX_KNOWLEDGE_SEARCH_EVIDENCE_ITEMS =
  3;

export const MAX_KNOWLEDGE_SEARCH_EVIDENCE_CHARS =
  240;

/**
 * Returns true only for normalized vault-relative paths that cannot traverse outside
 * the configured vault or use host-specific absolute-path syntax.
 */
function isNormalizedVaultRelativePath(
  value: string,
): boolean {
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(
      value,
    )
  ) {
    return false;
  }

  const segments =
    value.split("/");

  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== "..",
    )
  );
}

export const knowledgePathSchema =
  z
    .string()
    .trim()
    .min(1)
    .max(
      MAX_KNOWLEDGE_PATH_CHARS,
    )
    .refine(
      isNormalizedVaultRelativePath,
      "Knowledge path must be a normalized vault-relative path",
    );

export const knowledgeAuthoritySchema =
  z
    .object({
      tier:
        z.enum([
          "tier1",
          "tier2",
          "tier3",
        ]),
      class:
        z.enum([
          "curated",
          "historical",
          "source",
          "excluded",
        ]),
      access:
        z.enum([
          "default-searchable",
          "explicit-searchable",
          "source-searchable",
          "exact-read-only",
        ]),
    })
    .strict();

export const knowledgeRefSchema =
  z
    .object({
      source:
        z.literal(
          "vault",
        ),
      path:
        knowledgePathSchema,
      heading:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_HEADING_CHARS,
          )
          .optional(),
      excerpt:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_EXCERPT_CHARS,
          )
          .optional(),
    })
    .strict();

export const knowledgeRefCollectionSchema =
  z
    .array(
      knowledgeRefSchema,
    )
    .max(
      MAX_KNOWLEDGE_REFS,
    )
    .superRefine(
      (
        refs,
        context,
      ) => {
        const aggregateChars =
          refs.reduce(
            (
              total,
              ref,
            ) =>
              total +
              (
                ref.excerpt
                  ?.length ??
                0
              ),
            0,
          );

        if (
          aggregateChars >
          MAX_KNOWLEDGE_CONTEXT_CHARS
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            message:
              `Knowledge excerpts must not exceed ${MAX_KNOWLEDGE_CONTEXT_CHARS} aggregate characters`,
          });
        }
      },
    );

export const knowledgeSearchAreaSchema =
  z.enum([
    "project",
    "wiki",
  ]);

export const knowledgeSearchScopeSchema =
  z.enum([
    "default",
    "tier2",
  ]);

export const knowledgeSearchRequestSchema =
  z
    .object({
      query:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_QUERY_CHARS,
          ),
      area:
        knowledgeSearchAreaSchema
          .default(
            "project",
          ),
      scope:
        knowledgeSearchScopeSchema
          .default(
            "default",
          ),
      limit:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_KNOWLEDGE_SEARCH_RESULTS,
          )
          .default(
            MAX_KNOWLEDGE_SEARCH_RESULTS,
          ),
    })
    .strict();

export const knowledgeSectionRequestSchema =
  z
    .object({
      path:
        knowledgePathSchema,
      heading:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_HEADING_CHARS,
          )
          .optional(),
      maxChars:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_KNOWLEDGE_EXCERPT_CHARS,
          )
          .default(
            MAX_KNOWLEDGE_EXCERPT_CHARS,
          ),
    })
    .strict();

const searchMetadataValueSchema =
  z
    .string()
    .max(
      MAX_KNOWLEDGE_METADATA_VALUE_CHARS,
    );

export const knowledgeSearchMetadataSchema =
  z
    .object({
      project:
        z
          .array(
            searchMetadataValueSchema,
          )
          .max(
            MAX_KNOWLEDGE_METADATA_VALUES,
          ),
      tags:
        z
          .array(
            searchMetadataValueSchema,
          )
          .max(
            MAX_KNOWLEDGE_METADATA_VALUES,
          ),
      type:
        z
          .array(
            searchMetadataValueSchema,
          )
          .max(
            MAX_KNOWLEDGE_METADATA_VALUES,
          ),
      status:
        z
          .array(
            searchMetadataValueSchema,
          )
          .max(
            MAX_KNOWLEDGE_METADATA_VALUES,
          ),
    })
    .strict();

export const knowledgeSearchEvidenceSchema =
  z
    .object({
      kind:
        z.enum([
          "title",
          "heading",
          "alias",
          "tag",
          "frontmatter",
          "body",
          "path",
        ]),
      text:
        z
          .string()
          .max(
            MAX_KNOWLEDGE_SEARCH_EVIDENCE_CHARS,
          ),
    })
    .strict();

export const knowledgeSearchResultSchema =
  z
    .object({
      path:
        knowledgePathSchema,
      title:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_TITLE_CHARS,
          ),
      authority:
        knowledgeAuthoritySchema,
      score:
        z.number(),
      metadata:
        knowledgeSearchMetadataSchema,
      evidence:
        z
          .array(
            knowledgeSearchEvidenceSchema,
          )
          .max(
            MAX_KNOWLEDGE_SEARCH_EVIDENCE_ITEMS,
          ),
    })
    .strict();

export const knowledgeAvailabilityStatusSchema =
  z.enum([
    "ok",
    "knowledge_unavailable",
    "retrieval_error",
  ]);

export const knowledgeSearchEnvelopeSchema =
  z
    .object({
      source:
        z.literal(
          "vault",
        ),
      kind:
        z.literal(
          "durable_knowledge",
        ),
      runtimeAuthoritative:
        z.literal(
          false,
        ),
      status:
        knowledgeAvailabilityStatusSchema,
      results:
        z
          .array(
            knowledgeSearchResultSchema,
          )
          .max(
            MAX_KNOWLEDGE_SEARCH_RESULTS,
          ),
      message:
        z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional(),
    })
    .strict();

export const knowledgeSectionSchema =
  z
    .object({
      ref:
        knowledgeRefSchema,
      title:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_KNOWLEDGE_TITLE_CHARS,
          ),
      authority:
        knowledgeAuthoritySchema,
      truncated:
        z.boolean(),
      charsReturned:
        z
          .number()
          .int()
          .nonnegative(),
      bytesReturned:
        z
          .number()
          .int()
          .nonnegative(),
    })
    .strict();

export const knowledgeSectionEnvelopeSchema =
  z
    .object({
      source:
        z.literal(
          "vault",
        ),
      kind:
        z.literal(
          "durable_knowledge",
        ),
      runtimeAuthoritative:
        z.literal(
          false,
        ),
      status:
        knowledgeAvailabilityStatusSchema,
      section:
        knowledgeSectionSchema
          .nullable(),
      message:
        z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional(),
    })
    .strict();

export type KnowledgeAuthority =
  z.infer<
    typeof knowledgeAuthoritySchema
  >;

export type KnowledgeRef =
  z.infer<
    typeof knowledgeRefSchema
  >;

export type KnowledgeSearchArea =
  z.infer<
    typeof knowledgeSearchAreaSchema
  >;

export type KnowledgeSearchScope =
  z.infer<
    typeof knowledgeSearchScopeSchema
  >;

export type KnowledgeSearchRequest =
  z.infer<
    typeof knowledgeSearchRequestSchema
  >;

export type KnowledgeSectionRequest =
  z.infer<
    typeof knowledgeSectionRequestSchema
  >;

export type KnowledgeSearchResult =
  z.infer<
    typeof knowledgeSearchResultSchema
  >;

export type KnowledgeSearchEnvelope =
  z.infer<
    typeof knowledgeSearchEnvelopeSchema
  >;

export type KnowledgeSection =
  z.infer<
    typeof knowledgeSectionSchema
  >;

export type KnowledgeSectionEnvelope =
  z.infer<
    typeof knowledgeSectionEnvelopeSchema
  >;
