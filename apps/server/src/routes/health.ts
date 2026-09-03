import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@orc/shared";

import { db } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (): Promise<HealthResponse> => {
    let dbStatus: HealthResponse["db"] = "down";

    try {
      await db.execute(sql`select 1`);
      dbStatus = "up";
    } catch (error) {
      app.log.warn({ error }, "Health check DB ping failed");
    }

    return {
      status: dbStatus === "up" ? "ok" : "degraded",
      db: dbStatus,
      timestamp: new Date().toISOString(),
    };
  });
}
