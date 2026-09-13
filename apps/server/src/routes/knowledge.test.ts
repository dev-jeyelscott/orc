import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createKnowledgeCategory: vi.fn(),
  deleteKnowledgeCategory: vi.fn(),
  getKnowledgeCategory: vi.fn(),
  getKnowledgeCategoryFileContent: vi.fn(),
  listKnowledgeCategories: vi.fn(),
  listKnowledgeCategoryFiles: vi.fn(),
  updateKnowledgeCategory: vi.fn(),
  createIngestionBatch: vi.fn(),
  getIngestionBatch: vi.fn(),
  listIngestionBatches: vi.fn(),
  reviewProposal: vi.fn(),
  startIngestionAnalysis: vi.fn(),
  submitIngestionBatch: vi.fn(),
}));

vi.mock("../services/knowledge-category-service.js", () => ({
  KnowledgeCategoryServiceError: class KnowledgeCategoryServiceError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  },
  createKnowledgeCategory: mocks.createKnowledgeCategory,
  deleteKnowledgeCategory: mocks.deleteKnowledgeCategory,
  getKnowledgeCategory: mocks.getKnowledgeCategory,
  getKnowledgeCategoryFileContent: mocks.getKnowledgeCategoryFileContent,
  listKnowledgeCategories: mocks.listKnowledgeCategories,
  listKnowledgeCategoryFiles: mocks.listKnowledgeCategoryFiles,
  updateKnowledgeCategory: mocks.updateKnowledgeCategory,
}));

vi.mock("../services/knowledge-ingestion-service.js", () => ({
  KnowledgeIngestionServiceError: class KnowledgeIngestionServiceError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  },
  createIngestionBatch: mocks.createIngestionBatch,
  getIngestionBatch: mocks.getIngestionBatch,
  listIngestionBatches: mocks.listIngestionBatches,
  reviewProposal: mocks.reviewProposal,
  startIngestionAnalysis: mocks.startIngestionAnalysis,
}));

vi.mock("../services/knowledge-vault-publisher.js", () => ({
  submitIngestionBatch: mocks.submitIngestionBatch,
}));

const { KnowledgeCategoryServiceError } = await import(
  "../services/knowledge-category-service.js"
);
const { KnowledgeIngestionServiceError } = await import(
  "../services/knowledge-ingestion-service.js"
);
const { knowledgeRoutes } = await import("./knowledge.js");

const CATEGORY_ID = "00000000-0000-4000-9000-000000000097";
const category = {
  id: CATEGORY_ID,
  slug: "ui-ux-guidelines",
  name: "UI/UX Guidelines",
  description: "",
  vaultRootPath: "wiki/ui-ux",
  enabled: true,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  app = Fastify();
  await app.register(knowledgeRoutes);
});

afterEach(async () => {
  await app.close();
});

describe("Knowledge routes", () => {
  it("supports create, list, get, update, and delete", async () => {
    mocks.createKnowledgeCategory.mockResolvedValue(category);
    mocks.listKnowledgeCategories.mockResolvedValue([category]);
    mocks.getKnowledgeCategory.mockResolvedValue(category);
    mocks.updateKnowledgeCategory.mockResolvedValue({
      ...category,
      enabled: false,
    });
    mocks.deleteKnowledgeCategory.mockResolvedValue(true);

    const payload = {
      slug: category.slug,
      name: category.name,
      vaultRootPath: category.vaultRootPath,
    };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/knowledge",
          payload,
        })
      ).statusCode,
    ).toBe(201);
    expect(mocks.createKnowledgeCategory).toHaveBeenCalledWith(
      expect.objectContaining(payload),
    );

    expect(
      (await app.inject({ method: "GET", url: "/api/knowledge" })).json(),
    ).toEqual({ categories: [category] });

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/knowledge/${CATEGORY_ID}`,
        })
      ).json(),
    ).toEqual(category);

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/knowledge/${CATEGORY_ID}`,
          payload: { enabled: false },
        })
      ).json(),
    ).toEqual({ ...category, enabled: false });

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/knowledge/${CATEGORY_ID}`,
        })
      ).statusCode,
    ).toBe(204);
  });

  it("returns stable validation, absent, and conflict responses", async () => {
    expect(
      (
        await app.inject({ method: "POST", url: "/api/knowledge", payload: {} })
      ).statusCode,
    ).toBe(400);

    mocks.getKnowledgeCategory.mockResolvedValue(null);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/knowledge/${CATEGORY_ID}`,
        })
      ).json(),
    ).toEqual({ error: "knowledge_category_not_found" });

    mocks.deleteKnowledgeCategory.mockRejectedValue(
      new KnowledgeCategoryServiceError(
        "A Knowledge Category with that slug already exists",
        409,
      ),
    );
    const response = await app.inject({
      method: "DELETE",
      url: `/api/knowledge/${CATEGORY_ID}`,
    });
    expect(response.statusCode).toBe(409);
  });

  it("browses vault files and previews one file", async () => {
    mocks.listKnowledgeCategoryFiles.mockResolvedValue({
      status: "ok",
      files: [{ path: "wiki/ui-ux/forms.md", name: "forms.md" }],
    });
    mocks.getKnowledgeCategoryFileContent.mockResolvedValue({
      status: "ok",
      path: "wiki/ui-ux/forms.md",
      name: "forms.md",
      content: "# Forms\n",
    });

    const listing = await app.inject({
      method: "GET",
      url: `/api/knowledge/${CATEGORY_ID}/files`,
    });
    expect(listing.json()).toEqual({
      status: "ok",
      files: [{ path: "wiki/ui-ux/forms.md", name: "forms.md" }],
    });

    const preview = await app.inject({
      method: "GET",
      url: `/api/knowledge/${CATEGORY_ID}/files/content?path=wiki/ui-ux/forms.md`,
    });
    expect(preview.json()).toEqual({
      status: "ok",
      path: "wiki/ui-ux/forms.md",
      name: "forms.md",
      content: "# Forms\n",
    });
    expect(mocks.getKnowledgeCategoryFileContent).toHaveBeenCalledWith(
      CATEGORY_ID,
      "wiki/ui-ux/forms.md",
    );
  });

  it("returns 404 for files endpoints on an unknown category", async () => {
    mocks.listKnowledgeCategoryFiles.mockResolvedValue(null);
    mocks.getKnowledgeCategoryFileContent.mockResolvedValue(null);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/knowledge/${CATEGORY_ID}/files`,
        })
      ).json(),
    ).toEqual({ error: "knowledge_category_not_found" });

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/knowledge/${CATEGORY_ID}/files/content?path=wiki/ui-ux/forms.md`,
        })
      ).json(),
    ).toEqual({ error: "knowledge_category_not_found" });
  });

  it("rejects a file preview request missing the path query parameter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/knowledge/${CATEGORY_ID}/files/content`,
    });

    expect(response.statusCode).toBe(400);
  });

  const BATCH_ID = "00000000-0000-4000-9000-000000000098";
  const PROPOSAL_ID = "00000000-0000-4000-9000-000000000099";
  const proposal = {
    id: PROPOSAL_ID,
    batchId: BATCH_ID,
    operation: "CREATE" as const,
    targetPath: "wiki/ui-ux/new.md",
    targetHeading: null,
    confidenceScore: 0.9,
    confidenceLevel: "high" as const,
    title: "New note",
    rationale: "Covers a gap.",
    evidence: [],
    existingContentHash: null,
    proposedContent: "# New note\n",
    conflictDetails: null,
    reviewStatus: "pending" as const,
    reviewerNote: null,
    appliedAt: null,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };

  it("records a review decision on one proposal", async () => {
    mocks.reviewProposal.mockResolvedValue({ ...proposal, reviewStatus: "approved" });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/ingestions/${BATCH_ID}/proposals/${PROPOSAL_ID}`,
      payload: { reviewStatus: "approved", reviewerNote: "Looks good." },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reviewStatus: "approved" });
    expect(mocks.reviewProposal).toHaveBeenCalledWith(BATCH_ID, PROPOSAL_ID, {
      reviewStatus: "approved",
      reviewerNote: "Looks good.",
    });
  });

  it("rejects an invalid review decision payload", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/ingestions/${BATCH_ID}/proposals/${PROPOSAL_ID}`,
      payload: { reviewStatus: "pending" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.reviewProposal).not.toHaveBeenCalled();
  });

  it("surfaces an illegal review transition as an error response", async () => {
    mocks.reviewProposal.mockRejectedValue(
      new KnowledgeIngestionServiceError(
        "Proposals can only be reviewed once analysis has produced a review-ready batch",
        409,
      ),
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/ingestions/${BATCH_ID}/proposals/${PROPOSAL_ID}`,
      payload: { reviewStatus: "approved" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("submits a batch and returns the publish result", async () => {
    mocks.submitIngestionBatch.mockResolvedValue({
      batch: { id: BATCH_ID, status: "committed" },
      appliedCount: 1,
      deniedCount: 0,
      noChangeCount: 0,
      commitSha: "a".repeat(40),
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/knowledge/ingestions/${BATCH_ID}/submit`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ appliedCount: 1, commitSha: "a".repeat(40) });
    expect(mocks.submitIngestionBatch).toHaveBeenCalledWith(BATCH_ID);
  });

  it("surfaces a not-ready submit rejection", async () => {
    mocks.submitIngestionBatch.mockRejectedValue(
      new KnowledgeIngestionServiceError("Batch is not ready to submit: 1 proposal(s) awaiting a decision.", 409),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/knowledge/ingestions/${BATCH_ID}/submit`,
    });

    expect(response.statusCode).toBe(409);
  });
});
