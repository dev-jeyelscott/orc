import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import {
  MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
  type CreateProjectDocumentRequest,
  type ProjectDocumentMetadata,
} from "@orc/shared";

import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { projectDocumentChunks, projectDocuments } from "../db/schema.js";

import { chunkMarkdown, chunkPlainText } from "./project-document-chunker.js";
import { getProjectByPath } from "./project-discovery.js";

export class ProjectDocumentServiceError extends Error {
  /**
   * Creates a project document service error carrying its HTTP status.
   */
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/**
 * Resolves and canonicalizes one project path through filesystem-backed discovery.
 */
async function requireProject(projectPath: string) {
  const project = await getProjectByPath(env.WORKSPACE_ROOT, projectPath);

  if (!project) {
    throw new ProjectDocumentServiceError(
      "The selected project is no longer available",
      404,
    );
  }

  return project;
}

/**
 * Strips a leading UTF-8 BOM and normalizes CRLF/CR line endings to LF.
 */
function normalizeContent(rawContent: string): string {
  const withoutBom =
    rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;

  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Rejects content that is blank or that contains NUL bytes, which Postgres text columns cannot store.
 */
function requireUploadableContent(normalized: string): void {
  if (normalized.trim().length === 0) {
    throw new ProjectDocumentServiceError(
      "Document content must not be blank",
      400,
    );
  }

  if (normalized.includes("\0")) {
    throw new ProjectDocumentServiceError(
      "Document content must not contain NUL bytes",
      400,
    );
  }
}

/**
 * Hashes normalized text content into the lowercase SHA-256 hex format used across project document tables.
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Serializes a project document database row into the shared API contract.
 */
function serializeProjectDocument(
  row: typeof projectDocuments.$inferSelect,
): ProjectDocumentMetadata {
  return {
    id: row.id,
    teamId: row.teamId,
    projectPath: row.projectPath,
    fileName: row.fileName,
    extension: row.extension as ".md" | ".txt",
    mediaType: row.mediaType as "text/markdown" | "text/plain",
    contentHash: row.contentHash,
    contentBytes: row.contentBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validates, normalizes, deterministically chunks, and transactionally persists one uploaded Project document.
 */
export async function createProjectDocument(
  input: CreateProjectDocumentRequest,
): Promise<{ document: ProjectDocumentMetadata; chunkCount: number }> {
  const project = await requireProject(input.projectPath);

  const normalized = normalizeContent(input.content);

  requireUploadableContent(normalized);

  const contentBytes = Buffer.byteLength(normalized, "utf8");

  if (contentBytes > MAX_PROJECT_DOCUMENT_UPLOAD_BYTES) {
    throw new ProjectDocumentServiceError(
      `Document content must not exceed ${MAX_PROJECT_DOCUMENT_UPLOAD_BYTES} bytes`,
      400,
    );
  }

  const contentHash = hashContent(normalized);

  const chunkDrafts =
    input.extension === ".md"
      ? chunkMarkdown(normalized)
      : chunkPlainText(normalized);

  const { document, chunkCount } = await db.transaction(async (tx) => {
    const [documentRow] = await tx
      .insert(projectDocuments)
      .values({
        teamId: input.teamId,
        projectPath: project.path,
        fileName: input.fileName,
        extension: input.extension,
        mediaType: input.mediaType,
        content: normalized,
        contentHash,
        contentBytes,
      })
      .returning();

    await tx.insert(projectDocumentChunks).values(
      chunkDrafts.map((chunk) => ({
        projectDocumentId: documentRow.id,
        sequence: chunk.sequence,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        content: chunk.content,
        contentHash: hashContent(chunk.content),
      })),
    );

    return {
      document: documentRow,
      chunkCount: chunkDrafts.length,
    };
  });

  return {
    document: serializeProjectDocument(document),
    chunkCount,
  };
}

/**
 * Lists Project documents scoped to one Team and canonical Project path, ordered by most recently created.
 */
export async function listProjectDocuments(
  teamId: string,
  projectPath: string,
): Promise<ProjectDocumentMetadata[]> {
  const project = await requireProject(projectPath);

  const rows = await db
    .select()
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.teamId, teamId),
        eq(projectDocuments.projectPath, project.path),
      ),
    )
    .orderBy(desc(projectDocuments.createdAt));

  return rows.map(serializeProjectDocument);
}
