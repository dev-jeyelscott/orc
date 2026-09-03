import { projectListResponseSchema, type ProjectListResponse } from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export async function getProjects(): Promise<ProjectListResponse> {
  const response = await fetch(`${SERVER_URL}/api/projects`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load projects: ${response.status}`);
  }

  return projectListResponseSchema.parse(await response.json());
}
