import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db, queryClient } from "./client.js";
import { logger } from "../logger.js";

async function main() {
  logger.info("Running database migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Migrations complete.");
  await queryClient.end();
}

main().catch((error) => {
  logger.error({ error }, "Migration failed");
  process.exit(1);
});
