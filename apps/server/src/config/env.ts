import os from "node:os";
import path from "node:path";

import {
  z,
} from "zod";

/**
 * Expands a leading home-directory marker using the current process user's home.
 */
function expandHome(
  value: string,
): string {
  if (
    value === "~"
  ) {
    return os.homedir();
  }

  if (
    value.startsWith(
      "~/",
    )
  ) {
    return path.join(
      os.homedir(),
      value.slice(2),
    );
  }

  return value;
}

const envSchema =
  z.object({
    WORKSPACE_ROOT:
      z.string()
        .default(
          path.join(
            os.homedir(),
            "workspace",
          ),
        )
        .transform(
          expandHome,
        ),
    DATABASE_URL:
      z.string()
        .min(
          1,
          "DATABASE_URL is required",
        ),
    SERVER_PORT:
      z.coerce
        .number()
        .int()
        .positive()
        .default(4000),
    NODE_ENV:
      z.enum([
        "development",
        "production",
        "test",
      ]).default(
        "development",
      ),
    MAX_WORKFLOW_EXECUTIONS:
      z.coerce
        .number()
        .int()
        .positive()
        .default(10),
    NOTION_API_KEY:
      z.string()
        .trim()
        .min(1)
        .optional(),
    NOTION_DATA_SOURCE_ID:
      z.string()
        .trim()
        .min(1)
        .optional(),
    NOTION_API_VERSION:
      z.literal(
        "2026-03-11",
      ).optional(),
    NOTION_POLL_INTERVAL_SECONDS:
      z.coerce
        .number()
        .int()
        .positive()
        .optional(),
    NOTION_POST_APPROVAL_DELAY_SECONDS:
      z.coerce
        .number()
        .int()
        .nonnegative()
        .optional(),
  })
    .superRefine(
      (
        value,
        context,
      ) => {
        const notionConfigured =
          [
            value.NOTION_API_KEY,
            value.NOTION_DATA_SOURCE_ID,
            value.NOTION_API_VERSION,
            value.NOTION_POLL_INTERVAL_SECONDS,
            value.NOTION_POST_APPROVAL_DELAY_SECONDS,
          ].some(
            (item) =>
              item !==
              undefined,
          );

        if (
          !notionConfigured
        ) {
          return;
        }

        const required = [
          [
            "NOTION_API_KEY",
            value.NOTION_API_KEY,
          ],
          [
            "NOTION_DATA_SOURCE_ID",
            value.NOTION_DATA_SOURCE_ID,
          ],
          [
            "NOTION_API_VERSION",
            value.NOTION_API_VERSION,
          ],
          [
            "NOTION_POLL_INTERVAL_SECONDS",
            value.NOTION_POLL_INTERVAL_SECONDS,
          ],
          [
            "NOTION_POST_APPROVAL_DELAY_SECONDS",
            value.NOTION_POST_APPROVAL_DELAY_SECONDS,
          ],
        ] as const;

        for (
          const [
            field,
            fieldValue,
          ] of required
        ) {
          if (
            fieldValue !==
            undefined
          ) {
            continue;
          }

          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            path: [
              field,
            ],
            message:
              `${field} is required when the Notion task source is configured`,
          });
        }
      },
    );

/**
 * Validates process environment configuration and reports all invalid fields together.
 */
function loadEnv() {
  const parsed =
    envSchema.safeParse(
      process.env,
    );

  if (
    !parsed.success
  ) {
    const details =
      parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.join(".") || "environment"}: ${issue.message}`,
        )
        .join(
          ", ",
        );

    throw new Error(
      `Invalid environment configuration: ${details}`,
    );
  }

  return parsed.data;
}

export const env =
  loadEnv();
