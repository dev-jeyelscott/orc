/*
 * Integration tests run against a dedicated PostgreSQL database, never the
 * development database the dashboard uses. The test database is wiped and
 * re-migrated before every run, so its name must end in `_test` as a guard
 * against ever pointing that reset at real data.
 */

/** Schema holding the post-migration snapshot that each test file is reset to. */
export const BASELINE_SCHEMA = "orc_test_baseline";

/** Sibling of the test ORC_CONFIG_ROOT holding the pristine exported `.orc/` tree. */
export const BASELINE_CONFIG_DIR = ".orc-baseline";

/**
 * Resolves the test database URL: `TEST_DATABASE_URL` when set, otherwise
 * `DATABASE_URL` with `_test` appended to its database name.
 */
export function resolveTestDatabaseUrl(
  env: NodeJS.ProcessEnv,
): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  let url: URL;

  if (explicit) {
    url = new URL(explicit);
  } else {
    const devUrl = env.DATABASE_URL?.trim();

    if (!devUrl) {
      throw new Error(
        "Set TEST_DATABASE_URL (or DATABASE_URL) in apps/server/.env to run server tests.",
      );
    }

    url = new URL(devUrl);
    url.pathname = `/${databaseName(url)}_test`;
  }

  if (!databaseName(url).endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against database "${databaseName(url)}": the test database name must end in "_test" because it is wiped before every run.`,
    );
  }

  return url.toString();
}

/** Returns the database name segment of a PostgreSQL URL. */
export function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}
