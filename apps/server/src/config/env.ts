import os from "node:os";
import path from "node:path";

import { z } from "zod";

function expandHome(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

const envSchema = z.object({
  WORKSPACE_ROOT: z
    .string()
    .default(path.join(os.homedir(), "workspace"))
    .transform(expandHome),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();
