import { z } from "zod";

export const MAX_PROJECT_DOCUMENT_SELECTIONS =
  5;

export const MAX_PROJECT_DOCUMENT_FILE_NAME_CHARS =
  255;

export const MAX_PROJECT_DOCUMENT_PROJECT_PATH_CHARS =
  4096;

export const MAX_PROJECT_DOCUMENT_UPLOAD_BYTES =
  1_048_576;

export const MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS =
  5;

export const MAX_PROJECT_DOCUMENT_EXCERPT_CHARS =
  1_200;

export const MAX_PROJECT_DOCUMENT_CONTEXT_CHARS =
  5_000;

export const projectDocumentIdSchema =
  z.string().uuid();

export const projectDocumentExtensionSchema =
  z.enum([
    ".md",
    ".txt",
  ]);

export const projectDocumentMediaTypeSchema =
  z.enum([
    "text/markdown",
    "text/plain",
  ]);

export const projectDocumentHashSchema =
  z
    .string()
    .regex(
      /^[0-9a-f]{64}$/,
      "Document hashes must be lowercase SHA-256 hex values",
    );

const projectDocumentFileNameSchema =
  z
    .string()
    .trim()
    .min(1)
    .max(
      MAX_PROJECT_DOCUMENT_FILE_NAME_CHARS,
    )
    .refine(
      (
        value,
      ) =>
        !value.includes(
          "/",
        ) &&
        !value.includes(
          "\\",
        ),
      {
        message:
          "Document file names must not contain path separators",
      },
    );

/**
 * Validates that one canonical extension, media type, and file name describe the same supported text format.
 */
function validateProjectDocumentFileMetadata(
  value: {
    fileName:
      string;
    extension:
      ".md" | ".txt";
    mediaType:
      "text/markdown" | "text/plain";
  },
  context:
    z.RefinementCtx,
): void {
  const expectedMediaType =
    value.extension ===
    ".md"
      ? "text/markdown"
      : "text/plain";

  if (
    value.mediaType !==
    expectedMediaType
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode
          .custom,
      path: [
        "mediaType",
      ],
      message:
        `Expected ${expectedMediaType} for ${value.extension}`,
    });
  }

  if (
    !value.fileName.endsWith(
      value.extension,
    )
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode
          .custom,
      path: [
        "fileName",
      ],
      message:
        `File name must end with ${value.extension}`,
    });
  }
}

export const projectDocumentUploadMetadataSchema =
  z
    .object({
      fileName:
        projectDocumentFileNameSchema,
      extension:
        projectDocumentExtensionSchema,
      mediaType:
        projectDocumentMediaTypeSchema,
      sizeBytes:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
    })
    .strict()
    .superRefine(
      validateProjectDocumentFileMetadata,
    );

export const createProjectDocumentRequestSchema =
  z
    .object({
      teamId:
        z.string().uuid(),
      projectPath:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_PROJECT_PATH_CHARS,
          ),
      fileName:
        projectDocumentFileNameSchema,
      extension:
        projectDocumentExtensionSchema,
      mediaType:
        projectDocumentMediaTypeSchema,
      content:
        z
          .string()
          .min(1),
    })
    .strict()
    .superRefine(
      validateProjectDocumentFileMetadata,
    );

export const projectDocumentMetadataSchema =
  z
    .object({
      id:
        projectDocumentIdSchema,
      teamId:
        z.string().uuid(),
      projectPath:
        z
          .string()
          .trim()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_PROJECT_PATH_CHARS,
          ),
      fileName:
        projectDocumentFileNameSchema,
      extension:
        projectDocumentExtensionSchema,
      mediaType:
        projectDocumentMediaTypeSchema,
      contentHash:
        projectDocumentHashSchema,
      contentBytes:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
      createdAt:
        z.string().datetime(),
      updatedAt:
        z.string().datetime(),
    })
    .strict()
    .superRefine(
      validateProjectDocumentFileMetadata,
    );

export const projectDocumentAttachmentSchema =
  z
    .object({
      id:
        projectDocumentIdSchema,
      fileName:
        projectDocumentFileNameSchema,
      extension:
        projectDocumentExtensionSchema,
      mediaType:
        projectDocumentMediaTypeSchema,
      contentHash:
        projectDocumentHashSchema,
      contentBytes:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
    })
    .strict();

export const projectDocumentListResponseSchema =
  z
    .object({
      documents:
        z.array(
          projectDocumentMetadataSchema,
        ),
    })
    .strict();

export const projectDocumentCreateResponseSchema =
  z
    .object({
      document:
        projectDocumentMetadataSchema,
      chunkCount:
        z
          .number()
          .int()
          .min(1),
    })
    .strict();

export const projectDocumentIdCollectionSchema =
  z
    .array(
      projectDocumentIdSchema,
    )
    .max(
      MAX_PROJECT_DOCUMENT_SELECTIONS,
    )
    .superRefine(
      (
        documentIds,
        context,
      ) => {
        const seen =
          new Set<string>();

        documentIds.forEach(
          (
            documentId,
            index,
          ) => {
            if (
              seen.has(
                documentId,
              )
            ) {
              context.addIssue({
                code:
                  z
                    .ZodIssueCode
                    .custom,
                path: [
                  index,
                ],
                message:
                  "Document IDs must be unique",
              });

              return;
            }

            seen.add(
              documentId,
            );
          },
        );
      },
    );

export const projectDocumentChunkMetadataSchema =
  z
    .object({
      documentId:
        projectDocumentIdSchema,
      sequence:
        z
          .number()
          .int()
          .min(0)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
      startOffset:
        z
          .number()
          .int()
          .min(0)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
      endOffset:
        z
          .number()
          .int()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
      contentHash:
        projectDocumentHashSchema,
    })
    .strict()
    .superRefine(
      (
        chunk,
        context,
      ) => {
        if (
          chunk.endOffset <=
          chunk.startOffset
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "endOffset",
            ],
            message:
              "Chunk endOffset must be greater than startOffset",
          });
        }
      },
    );

export const uploadedProjectDocumentContextRefSchema =
  z
    .object({
      source:
        z.literal(
          "project_document",
        ),
      documentId:
        projectDocumentIdSchema,
      fileName:
        projectDocumentFileNameSchema,
      documentContentHash:
        projectDocumentHashSchema,
      chunkSequence:
        z
          .number()
          .int()
          .min(0)
          .max(
            MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
          ),
      chunkContentHash:
        projectDocumentHashSchema,
      heading:
        z
          .string()
          .trim()
          .min(1)
          .max(300)
          .optional(),
      excerpt:
        z
          .string()
          .min(1)
          .max(
            MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
          ),
    })
    .strict();

export const uploadedProjectDocumentContextCollectionSchema =
  z
    .array(
      uploadedProjectDocumentContextRefSchema,
    )
    .max(
      MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
    )
    .superRefine(
      (
        refs,
        context,
      ) => {
        const totalExcerptChars =
          refs.reduce(
            (
              total,
              ref,
            ) =>
              total +
              ref.excerpt
                .length,
            0,
          );

        if (
          totalExcerptChars >
          MAX_PROJECT_DOCUMENT_CONTEXT_CHARS
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            message:
              `Uploaded document excerpts exceed the ${MAX_PROJECT_DOCUMENT_CONTEXT_CHARS}-character aggregate limit`,
          });
        }

        const seen =
          new Set<string>();

        refs.forEach(
          (
            ref,
            index,
          ) => {
            const key =
              [
                ref.documentId,
                ref.chunkSequence,
                ref.chunkContentHash,
              ].join(
                "\u0000",
              );

            if (
              seen.has(
                key,
              )
            ) {
              context.addIssue({
                code:
                  z
                    .ZodIssueCode
                    .custom,
                path: [
                  index,
                ],
                message:
                  "Uploaded document context references must be unique",
              });

              return;
            }

            seen.add(
              key,
            );
          },
        );
      },
    );

export type ProjectDocumentId = z.infer<
  typeof projectDocumentIdSchema
>;

export type ProjectDocumentUploadMetadata =
  z.infer<
    typeof projectDocumentUploadMetadataSchema
  >;

export type ProjectDocumentMetadata =
  z.infer<
    typeof projectDocumentMetadataSchema
  >;

export type ProjectDocumentAttachment =
  z.infer<
    typeof projectDocumentAttachmentSchema
  >;

export type CreateProjectDocumentRequest =
  z.infer<
    typeof createProjectDocumentRequestSchema
  >;

export type ProjectDocumentListResponse =
  z.infer<
    typeof projectDocumentListResponseSchema
  >;

export type ProjectDocumentCreateResponse =
  z.infer<
    typeof projectDocumentCreateResponseSchema
  >;

export type ProjectDocumentChunkMetadata =
  z.infer<
    typeof projectDocumentChunkMetadataSchema
  >;

export type UploadedProjectDocumentContextRef =
  z.infer<
    typeof uploadedProjectDocumentContextRefSchema
  >;

export type UploadedProjectDocumentContext =
  z.infer<
    typeof uploadedProjectDocumentContextCollectionSchema
  >;
