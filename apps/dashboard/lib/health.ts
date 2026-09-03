import { healthResponseSchema, type HealthResponse } from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${SERVER_URL}/health`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
