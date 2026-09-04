import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const trackedEnvironment = {
  DATABASE_URL:
    process.env.DATABASE_URL,
  MAX_WORKFLOW_EXECUTIONS:
    process.env.MAX_WORKFLOW_EXECUTIONS,
  NOTION_API_KEY:
    process.env.NOTION_API_KEY,
  NOTION_DATA_SOURCE_ID:
    process.env.NOTION_DATA_SOURCE_ID,
  NOTION_API_VERSION:
    process.env.NOTION_API_VERSION,
  NOTION_POLL_INTERVAL_SECONDS:
    process.env.NOTION_POLL_INTERVAL_SECONDS,
  NOTION_POST_APPROVAL_DELAY_SECONDS:
    process.env.NOTION_POST_APPROVAL_DELAY_SECONDS,
};

/**
 * Restores one environment variable to its value from before this test file ran.
 */
function restoreEnvironmentValue(
  name:
    keyof typeof trackedEnvironment,
): void {
  const original =
    trackedEnvironment[
      name
    ];

  if (
    original ===
    undefined
  ) {
    delete process.env[
      name
    ];
    return;
  }

  process.env[
    name
  ] = original;
}

/**
 * Restores environment values changed by configuration tests.
 */
function restoreEnvironment(): void {
  for (
    const name of Object.keys(
      trackedEnvironment,
    ) as Array<
      keyof typeof trackedEnvironment
    >
  ) {
    restoreEnvironmentValue(
      name,
    );
  }
}

/**
 * Sets the minimum database environment required before importing the configuration module.
 */
function configureDatabase(): void {
  process.env.DATABASE_URL =
    trackedEnvironment.DATABASE_URL ||
    "postgresql://orc:orc@localhost:5432/orc";
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
        configureDatabase();

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
        configureDatabase();

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
        configureDatabase();

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

    it(
      "defaults Notion polling to 30 seconds and post-approval delay to 5 seconds",
      async () => {
        configureDatabase();

        delete process.env
          .NOTION_API_KEY;
        delete process.env
          .NOTION_DATA_SOURCE_ID;
        delete process.env
          .NOTION_API_VERSION;
        delete process.env
          .NOTION_POLL_INTERVAL_SECONDS;
        delete process.env
          .NOTION_POST_APPROVAL_DELAY_SECONDS;

        vi.resetModules();

        const { env } =
          await import("./env.js");

        expect(
          env.NOTION_API_VERSION,
        ).toBe(
          "2026-03-11",
        );

        expect(
          env.NOTION_POLL_INTERVAL_SECONDS,
        ).toBe(30);

        expect(
          env.NOTION_POST_APPROVAL_DELAY_SECONDS,
        ).toBe(5);
      },
    );

    it(
      "accepts explicit Notion polling and delay overrides",
      async () => {
        configureDatabase();

        process.env.NOTION_API_KEY =
          "ntn_test";
        process.env.NOTION_DATA_SOURCE_ID =
          "data-source";
        process.env.NOTION_POLL_INTERVAL_SECONDS =
          "45";
        process.env.NOTION_POST_APPROVAL_DELAY_SECONDS =
          "10";

        vi.resetModules();

        const { env } =
          await import("./env.js");

        expect(
          env.NOTION_POLL_INTERVAL_SECONDS,
        ).toBe(45);

        expect(
          env.NOTION_POST_APPROVAL_DELAY_SECONDS,
        ).toBe(10);
      },
    );

    it(
      "requires both Notion credentials when either credential is configured",
      async () => {
        configureDatabase();

        process.env.NOTION_API_KEY =
          "ntn_test";
        delete process.env
          .NOTION_DATA_SOURCE_ID;

        vi.resetModules();

        await expect(
          import("./env.js"),
        ).rejects.toThrow(
          /NOTION_DATA_SOURCE_ID/,
        );
      },
    );
  },
);
