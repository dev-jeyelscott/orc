import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const originalDatabaseUrl =
  process.env
    .DATABASE_URL;

const originalKnowledgeCommand =
  process.env
    .KNOWLEDGE_MCP_COMMAND;

const originalVaultRoot =
  process.env
    .KNOWLEDGE_VAULT_ROOT;

/**
 * Restores all environment values modified by the Phase 8 knowledge configuration tests.
 */
function restoreEnvironment():
  void {
  if (
    originalDatabaseUrl ===
    undefined
  ) {
    delete process.env
      .DATABASE_URL;
  } else {
    process.env
      .DATABASE_URL =
      originalDatabaseUrl;
  }

  if (
    originalKnowledgeCommand ===
    undefined
  ) {
    delete process.env
      .KNOWLEDGE_MCP_COMMAND;
  } else {
    process.env
      .KNOWLEDGE_MCP_COMMAND =
      originalKnowledgeCommand;
  }

  if (
    originalVaultRoot ===
    undefined
  ) {
    delete process.env
      .KNOWLEDGE_VAULT_ROOT;
  } else {
    process.env
      .KNOWLEDGE_VAULT_ROOT =
      originalVaultRoot;
  }
}

/**
 * Configures the minimum database value required before importing server environment configuration.
 */
function configureDatabase():
  void {
  process.env
    .DATABASE_URL =
    originalDatabaseUrl ??
    "postgresql://orc:orc@localhost:5432/orc";
}

describe(
  "knowledge environment configuration",
  () => {
    afterEach(
      () => {
        restoreEnvironment();
        vi.resetModules();
      },
    );

    it(
      "starts with knowledge completely unconfigured",
      async () => {
        configureDatabase();

        delete process.env
          .KNOWLEDGE_MCP_COMMAND;
        delete process.env
          .KNOWLEDGE_VAULT_ROOT;

        vi.resetModules();

        const {
          env,
        } =
          await import(
            "./env.js"
          );

        expect(
          env
            .KNOWLEDGE_MCP_COMMAND,
        ).toBeUndefined();
      },
    );

    it(
      "accepts an optional standalone MCP command",
      async () => {
        configureDatabase();

        process.env
          .KNOWLEDGE_MCP_COMMAND =
          "knowledge-vault-mcp";

        vi.resetModules();

        const {
          env,
        } =
          await import(
            "./env.js"
          );

        expect(
          env
            .KNOWLEDGE_MCP_COMMAND,
        ).toBe(
          "knowledge-vault-mcp",
        );
      },
    );

    it(
      "does not require ORC to validate the MCP-owned vault root",
      async () => {
        configureDatabase();

        process.env
          .KNOWLEDGE_MCP_COMMAND =
          "knowledge-vault-mcp";
        delete process.env
          .KNOWLEDGE_VAULT_ROOT;

        vi.resetModules();

        await expect(
          import(
            "./env.js"
          ),
        ).resolves.toBeDefined();
      },
    );
  },
);
