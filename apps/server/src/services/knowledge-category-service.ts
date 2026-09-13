import { asc, eq } from "drizzle-orm";

import type {
  CreateKnowledgeCategory,
  KnowledgeCategory,
  KnowledgeCategoryFileContentResponse,
  KnowledgeCategoryFileListResponse,
  UpdateKnowledgeCategory,
} from "@orc/shared";

import { db } from "../db/client.js";
import { knowledgeCategories } from "../db/schema.js";
import {
  listCategoryVaultFiles,
  readCategoryVaultFile,
} from "./knowledge-vault-fs.js";

export class KnowledgeCategoryServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/** Converts persisted Knowledge Category data into the shared API representation. */
function serializeKnowledgeCategory(
  row: typeof knowledgeCategories.$inferSelect,
): KnowledgeCategory {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps additive Knowledge Category table constraints into stable API errors. */
function translateDatabaseError(error: unknown): never {
  if (error instanceof KnowledgeCategoryServiceError) {
    throw error;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code;

    if (code === "23505") {
      throw new KnowledgeCategoryServiceError(
        "A Knowledge Category with that slug already exists",
        409,
      );
    }
  }

  throw error;
}

/** Lists Knowledge Categories in deterministic operator-facing order. */
export async function listKnowledgeCategories(): Promise<KnowledgeCategory[]> {
  const rows = await db
    .select()
    .from(knowledgeCategories)
    .orderBy(asc(knowledgeCategories.name), asc(knowledgeCategories.id));

  return rows.map(serializeKnowledgeCategory);
}

/** Gets one Knowledge Category by identifier. */
export async function getKnowledgeCategory(
  id: string,
): Promise<KnowledgeCategory | null> {
  const [category] = await db
    .select()
    .from(knowledgeCategories)
    .where(eq(knowledgeCategories.id, id));

  return category ? serializeKnowledgeCategory(category) : null;
}

/** Creates one Knowledge Category configuration. */
export async function createKnowledgeCategory(
  input: CreateKnowledgeCategory,
): Promise<KnowledgeCategory> {
  try {
    const [category] = await db
      .insert(knowledgeCategories)
      .values(input)
      .returning();

    return serializeKnowledgeCategory(category);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Updates a Knowledge Category's configuration. */
export async function updateKnowledgeCategory(
  id: string,
  input: UpdateKnowledgeCategory,
): Promise<KnowledgeCategory | null> {
  try {
    const [category] = await db
      .update(knowledgeCategories)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(knowledgeCategories.id, id))
      .returning();

    return category ? serializeKnowledgeCategory(category) : null;
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/** Deletes one Knowledge Category configuration. */
export async function deleteKnowledgeCategory(id: string): Promise<boolean> {
  try {
    const [deleted] = await db
      .delete(knowledgeCategories)
      .where(eq(knowledgeCategories.id, id))
      .returning({ id: knowledgeCategories.id });

    return Boolean(deleted);
  } catch (error) {
    return translateDatabaseError(error);
  }
}

/**
 * Lists the Markdown files directly inside one Knowledge Category's managed vault
 * directory. Returns null when the category itself does not exist.
 */
export async function listKnowledgeCategoryFiles(
  id: string,
): Promise<KnowledgeCategoryFileListResponse | null> {
  const category = await getKnowledgeCategory(id);

  if (!category) {
    return null;
  }

  const result = await listCategoryVaultFiles(category.vaultRootPath);

  if (result.status !== "ok") {
    return {
      status: result.status,
      files: result.files,
      message: describeUnavailability(result.status),
    };
  }

  return { status: "ok", files: result.files };
}

/**
 * Reads one exact Markdown file previously listed for a Knowledge Category. Returns
 * null when the category itself does not exist.
 */
export async function getKnowledgeCategoryFileContent(
  id: string,
  requestedPath: string,
): Promise<KnowledgeCategoryFileContentResponse | null> {
  const category = await getKnowledgeCategory(id);

  if (!category) {
    return null;
  }

  const result = await readCategoryVaultFile(
    category.vaultRootPath,
    requestedPath,
  );

  if (result.status !== "ok") {
    return {
      status: result.status,
      message: describeUnavailability(result.status),
    };
  }

  if (!result.file) {
    return {
      status: "retrieval_error",
      message: describeUnavailability("retrieval_error"),
    };
  }

  return {
    status: "ok",
    path: result.file.path,
    name: result.file.name,
    content: result.file.content,
  };
}

function describeUnavailability(
  status: "knowledge_unavailable" | "retrieval_error",
): string {
  return status === "knowledge_unavailable"
    ? "The knowledge vault is not currently configured or reachable."
    : "The requested vault file could not be read.";
}
