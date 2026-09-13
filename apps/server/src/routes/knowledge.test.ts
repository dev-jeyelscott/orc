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
  ...mocks,
}));

const { KnowledgeCategoryServiceError } = await import(
  "../services/knowledge-category-service.js"
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
});
