import { projectListResponseSchema, projectTeamAssignmentSchema, type ProjectListResponse, type ProjectTeamAssignment, type UpsertProjectTeamAssignment } from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export async function getProjects(): Promise<ProjectListResponse> {
  const response = await fetch(`${SERVER_URL}/api/projects`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load projects: ${response.status}`);
  }

  return projectListResponseSchema.parse(await response.json());
}

async function projectAssignmentRequest(path: string, options: RequestInit): Promise<ProjectTeamAssignment> {
  const response = await fetch(`${SERVER_URL}${path}`, { ...options, headers: { "content-type": "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }
  return projectTeamAssignmentSchema.parse(await response.json());
}

export function updateProjectTeamAssignment(projectId: string, input: UpsertProjectTeamAssignment): Promise<ProjectTeamAssignment> {
  return projectAssignmentRequest(`/api/projects/${projectId}/team-assignment`, { method: "PUT", body: JSON.stringify(input) });
}

export async function deleteProjectTeamAssignment(projectId: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/api/projects/${projectId}/team-assignment`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }
}
