import { dashboardSummarySchema, type DashboardSummary } from "@orc/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

/**
 * Loads and validates the bounded system dashboard read model.
 */
export async function getDashboard(): Promise<DashboardSummary> {
  const response = await fetch(`${SERVER_URL}/api/dashboard`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load dashboard: ${response.status}`);
  }

  return dashboardSummarySchema.parse(await response.json());
}
