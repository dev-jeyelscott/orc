import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@orc/shared";

const testState = vi.hoisted(() => ({
  project: null as Project | null,
}));

vi.mock("./project-discovery.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./project-discovery.js")>();

  return {
    ...actual,
    /**
     * Returns the configured test Project only for its canonical path.
     */
    getProjectByPath: vi.fn(async (_root: string, projectPath: string) =>
      testState.project?.path === projectPath ? testState.project : null,
    ),
  };
});

const { db } = await import("../db/client.js");
const { RESOLUTION_TEAM_ID } = await import("../db/seed-ids.js");
const { projectDocumentChunks, projectDocuments } = await import(
  "../db/schema.js"
);
const {
  createProjectDocument,
  listProjectDocuments,
  ProjectDocumentServiceError,
} = await import("./project-document-service.js");
const { MAX_PROJECT_DOCUMENT_UPLOAD_BYTES } = await import("@orc/shared");

const PROJECT_PATH = "/tmp/orc-test-project-document";

/**
 * Creates the canonical fake Project used by project document service tests.
 */
function makeProject(): Project {
  return {
    id: "test-project-document",
    name: "test-project-document",
    path: PROJECT_PATH,
    branch: "main",
    gitState: "clean",
    primaryFiles: ["package.json"],
    packageManager: "pnpm",
    stack: "node",
  };
}

const createdDocumentIds = new Set<string>();

beforeEach(() => {
  testState.project = makeProject();
});

afterEach(async () => {
  if (createdDocumentIds.size > 0) {
    await db
      .delete(projectDocumentChunks)
      .where(
        inArray(
          projectDocumentChunks.projectDocumentId,
          [...createdDocumentIds],
        ),
      );

    await db
      .delete(projectDocuments)
      .where(inArray(projectDocuments.id, [...createdDocumentIds]));
  }

  createdDocumentIds.clear();
});

/**
 * Persists a Project document through the service under test and tracks it for cleanup.
 */
async function createAndTrack(
  overrides: Partial<{
    fileName: string;
    extension: ".md" | ".txt";
    mediaType: "text/markdown" | "text/plain";
    content: string;
  }> = {},
) {
  const result = await createProjectDocument({
    teamId: RESOLUTION_TEAM_ID,
    projectPath: PROJECT_PATH,
    fileName: overrides.fileName ?? "roadmap.md",
    extension: overrides.extension ?? ".md",
    mediaType: overrides.mediaType ?? "text/markdown",
    content: overrides.content ?? "# Roadmap\nBody text.",
  });

  createdDocumentIds.add(result.document.id);

  return result;
}

describe("createProjectDocument", () => {
  it("persists a document and its chunks transactionally", async () => {
    const result = await createAndTrack({
      content: "# Roadmap\nIntro.\n## Phase\nDetails.",
    });

    expect(result.chunkCount).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(projectDocumentChunks)
      .where(eq(projectDocumentChunks.projectDocumentId, result.document.id));

    expect(rows).toHaveLength(result.chunkCount);
  });

  it("hashes content deterministically and accounts UTF-8 multi-byte size correctly", async () => {
    const content = "# Emoji\n\u{1F600} café content.";

    const result = await createAndTrack({ content });

    expect(result.document.contentBytes).toBe(
      Buffer.byteLength(`# Emoji\n\u{1F600} café content.`, "utf8"),
    );

    expect(result.document.contentBytes).toBeGreaterThan(content.length);
  });

  it("normalizes a UTF-8 BOM and CRLF line endings before hashing", async () => {
    const raw = "﻿# Title\r\nLine two\r\nLine three";

    const result = await createAndTrack({ content: raw });

    const [row] = await db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.id, result.document.id));

    expect(row.content.startsWith("﻿")).toBe(false);
    expect(row.content).not.toContain("\r");
  });

  it("allows identical content to be uploaded more than once as independent documents", async () => {
    const content = "# Same\nContent twice.";

    const first = await createAndTrack({
      fileName: "first.md",
      content,
    });

    const second = await createAndTrack({
      fileName: "second.md",
      content,
    });

    expect(first.document.contentHash).toBe(second.document.contentHash);
    expect(first.document.id).not.toBe(second.document.id);
  });

  it("rejects blank content", async () => {
    await expect(
      createAndTrack({ content: "   \n\n  " }),
    ).rejects.toThrow(ProjectDocumentServiceError);
  });

  it("rejects content containing NUL bytes", async () => {
    await expect(
      createAndTrack({ content: "# Title\n\0bad" }),
    ).rejects.toThrow(ProjectDocumentServiceError);
  });

  it("rejects content exceeding the server-side byte limit", async () => {
    const oversized = "a".repeat(MAX_PROJECT_DOCUMENT_UPLOAD_BYTES + 1);

    await expect(
      createAndTrack({ content: oversized }),
    ).rejects.toThrow(ProjectDocumentServiceError);
  });

  it("rejects an unresolved Project path", async () => {
    testState.project = null;

    await expect(createAndTrack()).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("uses plain-text chunking for .txt uploads", async () => {
    const result = await createAndTrack({
      fileName: "notes.txt",
      extension: ".txt",
      mediaType: "text/plain",
      content: "Paragraph one.\n\nParagraph two.",
    });

    expect(result.chunkCount).toBeGreaterThan(0);
  });

  it("never leaves a partial document when chunk persistence fails", async () => {
    const beforeCount = (
      await db.select().from(projectDocuments)
    ).length;

    const chunkerModule = await import("./project-document-chunker.js");

    const spy = vi
      .spyOn(chunkerModule, "chunkMarkdown")
      .mockReturnValue([
        {
          sequence: 0,
          startOffset: 0,
          endOffset: 1,
          content: "a",
        },
        {
          sequence: 0,
          startOffset: 1,
          endOffset: 2,
          content: "b",
        },
      ]);

    await expect(
      createProjectDocument({
        teamId: RESOLUTION_TEAM_ID,
        projectPath: PROJECT_PATH,
        fileName: "broken.md",
        extension: ".md",
        mediaType: "text/markdown",
        content: "# Broken\nContent.",
      }),
    ).rejects.toThrow();

    spy.mockRestore();

    const afterCount = (
      await db.select().from(projectDocuments)
    ).length;

    expect(afterCount).toBe(beforeCount);
  });
});

describe("listProjectDocuments", () => {
  it("lists only documents scoped to the given Team and Project path, newest first", async () => {
    const first = await createAndTrack({ fileName: "a.md" });
    const second = await createAndTrack({ fileName: "b.md" });

    const documents = await listProjectDocuments(
      RESOLUTION_TEAM_ID,
      PROJECT_PATH,
    );

    const ids = documents.map((document) => document.id);

    expect(ids.indexOf(second.document.id)).toBeLessThan(
      ids.indexOf(first.document.id),
    );

    for (const document of documents) {
      expect(document).not.toHaveProperty("chunks");
      expect(document).not.toHaveProperty("content");
    }
  });

  it("rejects an unresolved Project path", async () => {
    testState.project = null;

    await expect(
      listProjectDocuments(RESOLUTION_TEAM_ID, PROJECT_PATH),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
