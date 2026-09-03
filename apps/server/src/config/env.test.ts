import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const originalDatabaseUrl =
  process.env.DATABASE_URL;
const originalWorkflowLimit =
  process.env.MAX_WORKFLOW_EXECUTIONS;

/**
 * Restores environment values changed by configuration tests.
 */
function restoreEnvironment(): void {
  if (
    originalDatabaseUrl === undefined
  ) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL =
      originalDatabaseUrl;
  }

  if (
    originalWorkflowLimit === undefined
  ) {
    delete process.env
      .MAX_WORKFLOW_EXECUTIONS;
  } else {
    process.env.MAX_WORKFLOW_EXECUTIONS =
      originalWorkflowLimit;
  }
}

describe(
  "environment configuration",
  () => {
    afterEach(() => {
      restoreEnvironment();
      vi.resetModules();
    });

    it(
      "defaults the workflow execution limit to 10",
      async () => {
        process.env.DATABASE_URL =
          originalDatabaseUrl ||
          "postgresql://orc:orc@localhost:5432/orc";
        delete process.env
          .MAX_WORKFLOW_EXECUTIONS;

        vi.resetModules();

        const { env } =
          await import("./env.js");

        expect(
          env.MAX_WORKFLOW_EXECUTIONS,
        ).toBe(10);
      },
    );

    it(
      "accepts a configured positive integer workflow limit",
      async () => {
        process.env.DATABASE_URL =
          originalDatabaseUrl ||
          "postgresql://orc:orc@localhost:5432/orc";
        process.env.MAX_WORKFLOW_EXECUTIONS =
          "7";

        vi.resetModules();

        const { env } =
          await import("./env.js");

        expect(
          env.MAX_WORKFLOW_EXECUTIONS,
        ).toBe(7);
      },
    );

    it.each([
      "0",
      "-1",
      "1.5",
      "not-a-number",
    ])(
      "rejects malformed workflow execution limit %s",
      async (value) => {
        process.env.DATABASE_URL =
          originalDatabaseUrl ||
          "postgresql://orc:orc@localhost:5432/orc";
        process.env.MAX_WORKFLOW_EXECUTIONS =
          value;

        vi.resetModules();

        await expect(
          import("./env.js"),
        ).rejects.toThrow(
          /MAX_WORKFLOW_EXECUTIONS/,
        );
      },
    );
  },
);
