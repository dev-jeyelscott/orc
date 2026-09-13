import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listCategoryVaultFiles,
  readCategoryVaultFile,
} from "./knowledge-vault-fs.js";

const originalVaultRoot = process.env.KNOWLEDGE_VAULT_ROOT;
let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "orc-knowledge-vault-"));
  process.env.KNOWLEDGE_VAULT_ROOT = vaultRoot;

  const categoryDir = path.join(vaultRoot, "wiki", "ui-ux");
  await mkdir(categoryDir, { recursive: true });
  await writeFile(path.join(categoryDir, "_index.md"), "# UI/UX Guidelines\n");
  await writeFile(path.join(categoryDir, "forms.md"), "# Forms\n");
  await writeFile(path.join(categoryDir, "notes.txt"), "not markdown");

  const secretDir = path.join(vaultRoot, "wiki", "secrets");
  await mkdir(secretDir, { recursive: true });
  await writeFile(path.join(secretDir, "hidden.md"), "top secret");
});

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true });

  if (originalVaultRoot === undefined) {
    delete process.env.KNOWLEDGE_VAULT_ROOT;
  } else {
    process.env.KNOWLEDGE_VAULT_ROOT = originalVaultRoot;
  }
});

describe("knowledge-vault-fs", () => {
  it("lists only Markdown files directly inside the category directory", async () => {
    const result = await listCategoryVaultFiles("wiki/ui-ux");

    expect(result.status).toBe("ok");
    expect(result.files).toEqual([
      { path: "wiki/ui-ux/_index.md", name: "_index.md" },
      { path: "wiki/ui-ux/forms.md", name: "forms.md" },
    ]);
  });

  it("reports knowledge_unavailable when the vault root is not configured", async () => {
    delete process.env.KNOWLEDGE_VAULT_ROOT;

    const result = await listCategoryVaultFiles("wiki/ui-ux");

    expect(result).toEqual({ status: "knowledge_unavailable", files: [] });
  });

  it("reports knowledge_unavailable when the category directory does not exist", async () => {
    const result = await listCategoryVaultFiles("wiki/does-not-exist");

    expect(result.status).toBe("knowledge_unavailable");
    expect(result.files).toEqual([]);
  });

  it("rejects a category root that would traverse outside the vault", async () => {
    const result = await listCategoryVaultFiles("../outside");

    expect(result).toEqual({ status: "retrieval_error", files: [] });
  });

  it("reads one exact file directly inside the category directory", async () => {
    const result = await readCategoryVaultFile(
      "wiki/ui-ux",
      "wiki/ui-ux/forms.md",
    );

    expect(result.status).toBe("ok");
    expect(result.file).toEqual({
      path: "wiki/ui-ux/forms.md",
      name: "forms.md",
      content: "# Forms\n",
    });
  });

  it("handles a nonexistent file safely", async () => {
    const result = await readCategoryVaultFile(
      "wiki/ui-ux",
      "wiki/ui-ux/missing.md",
    );

    expect(result).toEqual({ status: "knowledge_unavailable", file: null });
  });

  it("rejects a requested path outside the category directory", async () => {
    const outsideCategory = await readCategoryVaultFile(
      "wiki/ui-ux",
      "wiki/secrets/hidden.md",
    );
    expect(outsideCategory).toEqual({ status: "retrieval_error", file: null });

    const traversal = await readCategoryVaultFile(
      "wiki/ui-ux",
      "wiki/ui-ux/../secrets/hidden.md",
    );
    expect(traversal).toEqual({ status: "retrieval_error", file: null });

    const nestedPath = await readCategoryVaultFile(
      "wiki/ui-ux",
      "wiki/ui-ux/nested/forms.md",
    );
    expect(nestedPath).toEqual({ status: "retrieval_error", file: null });
  });
});
