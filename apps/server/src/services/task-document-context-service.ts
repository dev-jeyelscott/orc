import {
  and,
  asc,
  eq,
} from "drizzle-orm";

import {
  MAX_PROJECT_DOCUMENT_CONTEXT_CHARS,
  MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS,
  MAX_PROJECT_DOCUMENT_EXCERPT_CHARS,
  uploadedProjectDocumentContextCollectionSchema,
  type Task,
  type UploadedProjectDocumentContext,
} from "@orc/shared";

import { db } from "../db/client.js";
import {
  projectDocumentChunks,
  projectDocuments,
  taskDocuments,
} from "../db/schema.js";

type QueryExecutor = Pick<
  typeof db,
  "select"
>;

export type TaskDocumentContextRow = {
  documentId: string;
  fileName: string;
  documentContentHash: string;
  chunkSequence: number;
  chunkContentHash: string;
  content: string;
};

type Candidate = TaskDocumentContextRow & {
  heading?: string;
  score: number;
};

const HEADING_PATTERN = /^#{1,6}\s+(.+)$/m;

/** Normalizes lexical comparison input without changing the persisted excerpt. */
function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

function overlapCount(
  query: Set<string>,
  value: string,
): number {
  const valueTokens = tokens(value);
  let matches = 0;

  for (const token of query) {
    if (valueTokens.has(token)) {
      matches += 1;
    }
  }

  return matches;
}

function headingOf(content: string): string | undefined {
  const value = HEADING_PATTERN.exec(content)?.[1]?.trim();
  return value || undefined;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score ||
    left.fileName.normalize("NFKC").toLowerCase().localeCompare(
      right.fileName.normalize("NFKC").toLowerCase(),
    ) ||
    left.chunkSequence - right.chunkSequence;
}

/**
 * Selects deterministic, bounded lexical context from documents explicitly attached to a Task.
 */
export async function loadTaskDocumentContext(
  executor: QueryExecutor,
  task: Pick<Task, "id" | "teamId" | "projectPath" | "title" | "instruction">,
): Promise<UploadedProjectDocumentContext> {
  const rows = await executor
    .select({
      documentId: projectDocuments.id,
      fileName: projectDocuments.fileName,
      documentContentHash: projectDocuments.contentHash,
      chunkSequence: projectDocumentChunks.sequence,
      chunkContentHash: projectDocumentChunks.contentHash,
      content: projectDocumentChunks.content,
    })
    .from(taskDocuments)
    .innerJoin(
      projectDocuments,
      eq(taskDocuments.projectDocumentId, projectDocuments.id),
    )
    .innerJoin(
      projectDocumentChunks,
      eq(projectDocumentChunks.projectDocumentId, projectDocuments.id),
    )
    .where(
      and(
        eq(taskDocuments.taskId, task.id),
        eq(projectDocuments.teamId, task.teamId),
        eq(projectDocuments.projectPath, task.projectPath),
      ),
    )
    .orderBy(
      asc(projectDocuments.fileName),
      asc(projectDocumentChunks.sequence),
    );

  return selectTaskDocumentContext(rows, task);
}

/** Selects bounded context from caller-provided Task document chunk rows. */
export function selectTaskDocumentContext(
  rows: readonly TaskDocumentContextRow[],
  task: Pick<Task, "title" | "instruction">,
): UploadedProjectDocumentContext {
  const query = tokens(`${task.title} ${task.instruction}`);
  const candidates = rows.map((row) => {
    const heading = headingOf(row.content);
    const body = heading
      ? row.content.replace(HEADING_PATTERN, "")
      : row.content;
    const score =
      overlapCount(query, row.fileName) * 3 +
      overlapCount(query, heading ?? "") * 2 +
      overlapCount(query, body);

    return {
      ...row,
      heading,
      score,
    };
  });

  const ranked = candidates.filter((candidate) => candidate.score > 0).sort(compareCandidates);
  const selected = ranked.length
    ? ranked
    : [...candidates].sort(compareCandidates).slice(0, 1);
  const refs: UploadedProjectDocumentContext = [];
  let remainingChars = MAX_PROJECT_DOCUMENT_CONTEXT_CHARS;

  for (const candidate of selected) {
    if (refs.length >= MAX_PROJECT_DOCUMENT_CONTEXT_ITEMS || remainingChars <= 0) {
      break;
    }

    const excerpt = candidate.content
      .slice(0, Math.min(MAX_PROJECT_DOCUMENT_EXCERPT_CHARS, remainingChars))
      .trim();

    if (!excerpt) {
      continue;
    }

    refs.push({
      source: "project_document",
      documentId: candidate.documentId,
      fileName: candidate.fileName,
      documentContentHash: candidate.documentContentHash,
      chunkSequence: candidate.chunkSequence,
      chunkContentHash: candidate.chunkContentHash,
      ...(candidate.heading ? { heading: candidate.heading } : {}),
      excerpt,
    });
    remainingChars -= excerpt.length;
  }

  return uploadedProjectDocumentContextCollectionSchema.parse(refs);
}
