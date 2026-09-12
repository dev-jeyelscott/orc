import {
  departmentListResponseSchema,
  departmentSchema,
  type CreateDepartment,
  type Department,
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
): Promise<Department> {
  return requestDepartment(`/api/departments/${departmentId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteDepartment(departmentId: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/departments/${departmentId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}
