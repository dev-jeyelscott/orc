import {
  MAX_PROJECT_DOCUMENT_UPLOAD_BYTES,
  projectDocumentCreateResponseSchema,
  projectDocumentListResponseSchema,
  type CreateProjectDocumentRequest,
  type ProjectDocumentCreateResponse,
  type ProjectDocumentListResponse,
} from "@orc/shared";

const SERVER_URL =
  process.env
    .NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

const SUPPORTED_EXTENSIONS = [
  ".md",
  ".txt",
] as const;

/**
 * Describes one locally selected or previously uploaded document attached to the composer draft.
 */
export interface ComposerAttachment {
  localId: string;
  fileName: string;
  state: "uploading" | "error" | "done";
  documentId: string | null;
  errorMessage?: string;
}

/**
 * Executes one JSON API request and validates the returned payload.
 */
async function request<T>(
  path:
    string,
  options:
    RequestInit,
  parse:
    (
      value: unknown,
    ) => T,
): Promise<T> {
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
    const body =
      (
        await response
          .json()
          .catch(
            () =>
              null,
          )
      ) as
        | {
            error?:
              string;
          }
        | null;

    throw new Error(
      body?.error ??
        `Request failed: ${response.status}`,
    );
  }

  return parse(
    await response.json(),
  );
}

/**
 * Lists persisted project documents available for the selected Project and Team.
 */
export function listProjectDocuments(
  projectPath:
    string,
  teamId:
    string,
): Promise<ProjectDocumentListResponse> {
  const query =
    new URLSearchParams({
      projectPath,
      teamId,
    });

  return request(
    `/api/project-documents?${query.toString()}`,
    {},
    projectDocumentListResponseSchema.parse,
  );
}

/**
 * Persists one uploaded project document and its derived knowledge chunks.
 */
export function createProjectDocument(
  input:
    CreateProjectDocumentRequest,
): Promise<ProjectDocumentCreateResponse> {
  return request(
    "/api/project-documents",
    {
      method:
        "POST",
      body:
        JSON.stringify(
          input,
        ),
    },
    projectDocumentCreateResponseSchema.parse,
  );
}

/**
 * Reads a browser File as project document upload fields, rejecting anything the server would reject.
 * Server validation remains authoritative; this only avoids obviously doomed uploads.
 */
export async function resolveProjectDocumentUpload(
  file:
    File,
): Promise<{
  fileName:
    string;
  extension:
    ".md" | ".txt";
  mediaType:
    "text/markdown" | "text/plain";
  content:
    string;
}> {
  const extension =
    SUPPORTED_EXTENSIONS.find(
      (candidate) =>
        file.name
          .toLowerCase()
          .endsWith(
            candidate,
          ),
    );

  if (!extension) {
    throw new Error(
      `${file.name} is not a supported document type. Only .md and .txt files can be attached.`,
    );
  }

  if (
    file.size >
    MAX_PROJECT_DOCUMENT_UPLOAD_BYTES
  ) {
    throw new Error(
      `${file.name} is too large to attach. Documents must be ${MAX_PROJECT_DOCUMENT_UPLOAD_BYTES.toLocaleString()} bytes or smaller.`,
    );
  }

  const content =
    await file.text();

  if (!content.trim()) {
    throw new Error(
      `${file.name} is empty and cannot be attached.`,
    );
  }

  return {
    fileName:
      file.name,
    extension,
    mediaType:
      extension ===
      ".md"
        ? "text/markdown"
        : "text/plain",
    content,
  };
}
