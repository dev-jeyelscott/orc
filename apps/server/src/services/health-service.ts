import { sql } from "drizzle-orm";
import type { HealthResponse } from "@orc/shared";

import { db } from "../db/client.js";

/**
 * Reads application and database health from the authoritative database connection.
 */
export async function getHealthStatus(
  onDatabaseError?: (error: unknown) => void,
): Promise<HealthResponse> {
  let dbStatus: HealthResponse["db"] = "down";

  try {
    await db.execute(sql`select 1`);
    dbStatus = "up";
  } catch (error) {
    onDatabaseError?.(error);
  }

  return {
    status: dbStatus === "up" ? "ok" : "degraded",
    db: dbStatus,
    timestamp: new Date().toISOString(),
  };
}
