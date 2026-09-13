import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { knowledgeCategories } from "../db/schema.js";
import {
  createKnowledgeCategory,
  deleteKnowledgeCategory,
  getKnowledgeCategory,
  getKnowledgeCategoryFileContent,
  listKnowledgeCategories,
  listKnowledgeCategoryFiles,
  updateKnowledgeCategory,
} from "./knowledge-category-service.js";

const createdIds = new Set<string>();
const originalVaultRoot = process.env.KNOWLEDGE_VAULT_ROOT;
let vaultRoot: string;

const input = (label: string) => ({
  slug: `knowledge-${label}-${crypto.randomUUID()}`,
  name: `Knowledge ${label}`,
  description: "",
  vaultRootPath: `wiki/${label}`,
  enabled: true,
});

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "orc-knowledge-category-"));
  process.env.KNOWLEDGE_VAULT_ROOT = vaultRoot;
});

afterEach(async () => {
  for (const id of createdIds) {
    await db.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
  }
  createdIds.clear();

  await rm(vaultRoot, { recursive: true, force: true });

  if (originalVaultRoot === undefined) {
    delete process.env.KNOWLEDGE_VAULT_ROOT;
  } else {
    process.env.KNOWLEDGE_VAULT_ROOT = originalVaultRoot;
  }
});

describe("knowledge-category-service", () => {
  it("persists create, list, get, update, and deletion", async () => {
    const created = await createKnowledgeCategory(input("lifecycle"));
    createdIds.add(created.id);

    expect(created.enabled).toBe(true);
    expect((await getKnowledgeCategory(created.id))?.id).toBe(created.id);
    expect(
      (await listKnowledgeCategories()).some((item) => item.id === created.id),
    ).toBe(true);
    expect(
      (await updateKnowledgeCategory(created.id, { enabled: false }))?.enabled,
    ).toBe(false);
    expect(await deleteKnowledgeCategory(created.id)).toBe(true);
    createdIds.delete(created.id);
    expect(await getKnowledgeCategory(created.id)).toBeNull();
  });

  it("returns a stable conflict for duplicate slugs", async () => {
    const values = input("unique");
    const created = await createKnowledgeCategory(values);
    createdIds.add(created.id);

    await expect(
      createKnowledgeCategory({ ...values, name: "Another Category" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("browses vault files scoped to the category root", async () => {
    const category = await createKnowledgeCategory(input("uiux"));
    createdIds.add(category.id);

    const categoryDir = path.join(vaultRoot, category.vaultRootPath);
    await mkdir(categoryDir, { recursive: true });
    await writeFile(path.join(categoryDir, "_index.md"), "# Index\n");
    await writeFile(path.join(categoryDir, "forms.md"), "# Forms\n");

    const listing = await listKnowledgeCategoryFiles(category.id);
    expect(listing?.status).toBe("ok");
    expect(listing?.files).toEqual([
      { path: `${category.vaultRootPath}/_index.md`, name: "_index.md" },
      { path: `${category.vaultRootPath}/forms.md`, name: "forms.md" },
    ]);

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      `${category.vaultRootPath}/forms.md`,
    );
    expect(content).toEqual({
      status: "ok",
      path: `${category.vaultRootPath}/forms.md`,
      name: "forms.md",
      content: "# Forms\n",
    });
  });

  it("rejects a file preview path outside the category root", async () => {
    const category = await createKnowledgeCategory(input("scoped"));
    createdIds.add(category.id);

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      "wiki/other-category/secret.md",
    );

    expect(content).toEqual({
      status: "retrieval_error",
      message: "The requested vault file could not be read.",
    });
  });

  it("handles a nonexistent file safely", async () => {
    const category = await createKnowledgeCategory(input("missing"));
    createdIds.add(category.id);

    await mkdir(path.join(vaultRoot, category.vaultRootPath), {
      recursive: true,
    });

    const content = await getKnowledgeCategoryFileContent(
      category.id,
      `${category.vaultRootPath}/missing.md`,
    );

    expect(content?.status).toBe("knowledge_unavailable");
  });

  it("reports knowledge_unavailable when the vault is not configured", async () => {
    delete process.env.KNOWLEDGE_VAULT_ROOT;

    const category = await createKnowledgeCategory(input("unavailable"));
    createdIds.add(category.id);

    const listing = await listKnowledgeCategoryFiles(category.id);
    expect(listing?.status).toBe("knowledge_unavailable");
  });

  it("returns null for an unknown category id", async () => {
    const unknownId = "00000000-0000-4000-9000-000000000099";

    expect(await listKnowledgeCategoryFiles(unknownId)).toBeNull();
    expect(
      await getKnowledgeCategoryFileContent(unknownId, "wiki/x/a.md"),
    ).toBeNull();
  });
});
