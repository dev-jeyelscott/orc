import pino from "pino";

import { env } from "./config/env.js";

export const loggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
} as const;

// Standalone instance for code that runs outside a Fastify request context
// (startup/shutdown logs, one-off scripts like the migration runner).
export const logger = pino(loggerOptions);
