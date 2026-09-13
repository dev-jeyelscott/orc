import {
  knowledgeCategoryFileContentResponseSchema,
  knowledgeCategoryFileListResponseSchema,
  knowledgeCategoryListResponseSchema,
  knowledgeCategorySchema,
  type CreateKnowledgeCategory,
  type KnowledgeCategory,
  type KnowledgeCategoryFileContentResponse,
  type KnowledgeCategoryFileListResponse,
  type UpdateKnowledgeCategory,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

/**
 * Reads a backend Knowledge error response into stable operator-facing text.
 */
async function readErrorMessage(
  response: Response,
): Promise<string> {
  const body = (
    await response
      .json()
      .catch(() => null)
  ) as {
    error?: string;
  } | null;

  return (
    body?.error ??
    `Request failed: ${response.status}`
  );
}

/**
 * Executes a JSON Knowledge Category mutation and validates the returned contract.
 */
async function requestKnowledgeCategory(
  path: string,
  options: RequestInit,
): Promise<KnowledgeCategory> {
  const response =
    await fetch(
      `${SERVER_URL}${path}`,
      {
        ...options,
        headers: {
          "content-type":
            "application/json",
          ...options.headers,
        },
      },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response),
    );
  }

  return knowledgeCategorySchema.parse(
    await response.json(),
  );
}

/** Loads every configured Knowledge Category without browser caching. */
export async function getKnowledgeCategories(): Promise<
  KnowledgeCategory[]
> {
  const response =
    await fetch(
      `${SERVER_URL}/api/knowledge`,
      { cache: "no-store" },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response),
    );
  }

  return knowledgeCategoryListResponseSchema
    .parse(await response.json())
    .categories;
}

/** Loads one persisted Knowledge Category for its dedicated dashboard workspace. */
export function getKnowledgeCategory(
  categoryId: string,
  signal?: AbortSignal,
): Promise<KnowledgeCategory> {
  return requestKnowledgeCategory(
    `/api/knowledge/${categoryId}`,
    { cache: "no-store", signal },
  );
}

/** Creates one Knowledge Category configuration. */
export function createKnowledgeCategory(
  input: CreateKnowledgeCategory,
): Promise<KnowledgeCategory> {
  return requestKnowledgeCategory(
    "/api/knowledge",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

/** Updates one existing Knowledge Category configuration. */
export function updateKnowledgeCategory(
  categoryId: string,
  input: UpdateKnowledgeCategory,
): Promise<KnowledgeCategory> {
  return requestKnowledgeCategory(
    `/api/knowledge/${categoryId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

/** Deletes one Knowledge Category. */
export async function deleteKnowledgeCategory(
  categoryId: string,
): Promise<void> {
  const response =
    await fetch(
      `${SERVER_URL}/api/knowledge/${categoryId}`,
      { method: "DELETE" },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response),
    );
  }
}

/** Lists the Markdown files currently discoverable under a Knowledge Category's vault directory. */
export async function getKnowledgeCategoryFiles(
  categoryId: string,
  signal?: AbortSignal,
): Promise<KnowledgeCategoryFileListResponse> {
  const response =
    await fetch(
      `${SERVER_URL}/api/knowledge/${categoryId}/files`,
      { cache: "no-store", signal },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response),
    );
  }

  return knowledgeCategoryFileListResponseSchema.parse(
    await response.json(),
  );
}

/** Reads one exact Markdown file's content for read-only preview. */
export async function getKnowledgeCategoryFileContent(
  categoryId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<KnowledgeCategoryFileContentResponse> {
  const response =
    await fetch(
      `${SERVER_URL}/api/knowledge/${categoryId}/files/content?path=${encodeURIComponent(filePath)}`,
      { cache: "no-store", signal },
    );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response),
    );
  }

  return knowledgeCategoryFileContentResponseSchema.parse(
    await response.json(),
  );
}
