import {
  departmentKnowledgeResponseSchema,
  departmentListResponseSchema,
  departmentSchema,
  type CreateDepartment,
  type Department,
  type DepartmentKnowledgeCategory,
  type UpdateDepartment,
} from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  "http://localhost:4000";

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Request failed: ${response.status}`;
}

async function requestDepartment(
  path: string,
  options: RequestInit,
): Promise<Department> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return departmentSchema.parse(await response.json());
}

/** Loads the Department registry without browser caching. */
export async function getDepartments(): Promise<Department[]> {
  const response = await fetch(`${SERVER_URL}/api/departments`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return departmentListResponseSchema.parse(await response.json()).departments;
}

export function createDepartment(input: CreateDepartment): Promise<Department> {
  return requestDepartment("/api/departments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateDepartment(
  departmentId: string,
  input: UpdateDepartment,
  expectedRevision?: string | null,
): Promise<Department> {
  return requestDepartment(`/api/departments/${departmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...input, expectedRevision }),
  });
}

export async function deleteDepartment(departmentId: string, expectedRevision?: string | null): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/departments/${departmentId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}

/** Loads the primary Knowledge Categories a Department has declared. Discovery metadata only. */
export async function getDepartmentKnowledge(
  departmentId: string,
): Promise<DepartmentKnowledgeCategory[]> {
  const response = await fetch(`${SERVER_URL}/api/departments/${departmentId}/knowledge`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return departmentKnowledgeResponseSchema.parse(await response.json()).knowledge;
}

/** Replaces the full set of primary Knowledge Categories declared by a Department. */
export async function updateDepartmentKnowledge(
  departmentId: string,
  knowledgeCategoryIds: string[],
): Promise<DepartmentKnowledgeCategory[]> {
  const response = await fetch(`${SERVER_URL}/api/departments/${departmentId}/knowledge`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ knowledgeCategoryIds }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return departmentKnowledgeResponseSchema.parse(await response.json()).knowledge;
}
