import { configurationStatusResponseSchema, type ConfigurationStatusResponse } from "@orc/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

/** Reads the read-only Git-backed configuration status. Never mutates anything. */
export async function getConfigurationStatus(): Promise<ConfigurationStatusResponse> {
  const response = await fetch(`${SERVER_URL}/api/configuration/status`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Configuration status check failed with status ${response.status}`);
  }

  return configurationStatusResponseSchema.parse(await response.json());
}
