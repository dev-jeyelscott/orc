import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectDocuments: vi.fn(),
  createProjectDocument: vi.fn(),
}));

vi.mock("../services/project-document-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/project-document-service.js")
    >();

  return {
    ...actual,
    listProjectDocuments: mocks.listProjectDocuments,
    createProjectDocument: mocks.createProjectDocument,
  };
});

const { buildApp } = await import("../app.js");
const { ProjectDocumentServiceError } = await import(
  "../services/project-document-service.js"
);

let app: Awaited<ReturnType<typeof buildApp>>;

/**
 * Builds one valid document metadata fixture for route tests.
 */
function documentFixture(id: string) {
  return {
    id,
    teamId: "00000000-0000-4000-9000-000000000001",
    projectPath: "/tmp/orc-test-project-document",
    fileName: "roadmap.md",
    extension: ".md" as const,
    mediaType: "text/markdown" as const,
    contentHash: "a".repeat(64),
    contentBytes: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  mocks.listProjectDocuments.mockReset();
  mocks.createProjectDocument.mockReset();

  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/project-documents", () => {
  it("rejects a request missing required query parameters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/project-documents",
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.listProjectDocuments).not.toHaveBeenCalled();
  });

  it("lists documents without ever exposing chunk content", async () => {
    mocks.listProjectDocuments.mockResolvedValue([
      documentFixture("11111111-1111-4111-9111-111111111111"),
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/project-documents?projectPath=/tmp/orc-test-project-document&teamId=00000000-0000-4000-9000-000000000001",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.documents).toHaveLength(1);
    expect(body).not.toHaveProperty("chunks");
    expect(JSON.stringify(body)).not.toContain("\"content\"");
  });

  it("surfaces a not-found project as 404", async () => {
    mocks.listProjectDocuments.mockRejectedValue(
      new ProjectDocumentServiceError("The selected project is no longer available", 404),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/project-documents?projectPath=/tmp/missing&teamId=00000000-0000-4000-9000-000000000001",
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/project-documents", () => {
  it("rejects an invalid body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/project-documents",
      payload: {
        teamId: "not-a-uuid",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.createProjectDocument).not.toHaveBeenCalled();
  });

  it("creates a document and returns 201 without chunk bodies", async () => {
    mocks.createProjectDocument.mockResolvedValue({
      document: documentFixture("22222222-2222-4222-9222-222222222222"),
      chunkCount: 3,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/project-documents",
      payload: {
        teamId: "00000000-0000-4000-9000-000000000001",
        projectPath: "/tmp/orc-test-project-document",
        fileName: "roadmap.md",
        extension: ".md",
        mediaType: "text/markdown",
        content: "# Roadmap\nBody.",
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();

    expect(body.chunkCount).toBe(3);
    expect(JSON.stringify(body)).not.toContain("\"content\"");
    expect(mocks.createProjectDocument).toHaveBeenCalledWith({
      teamId: "00000000-0000-4000-9000-000000000001",
      projectPath: "/tmp/orc-test-project-document",
      fileName: "roadmap.md",
      extension: ".md",
      mediaType: "text/markdown",
      content: "# Roadmap\nBody.",
    });
  });

  it("surfaces a service validation error as its intended status", async () => {
    mocks.createProjectDocument.mockRejectedValue(
      new ProjectDocumentServiceError("Document content must not be blank", 400),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/project-documents",
      payload: {
        teamId: "00000000-0000-4000-9000-000000000001",
        projectPath: "/tmp/orc-test-project-document",
        fileName: "roadmap.md",
        extension: ".md",
        mediaType: "text/markdown",
        content: "   ",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
