import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";
import {
  dirname,
  resolve,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

const currentDirectory =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

/**
 * Reads one dashboard source file relative to the dashboard package root.
 */
function readDashboardFile(
  relativePath:
    string,
): string {
  return readFileSync(
    resolve(
      currentDirectory,
      "..",
      relativePath,
    ),
    "utf8",
  );
}

/**
 * Verifies Agents is no longer exposed as a top-level sidebar destination.
 */
function testAgentsRemovedFromSidebar(): void {
  const source =
    readDashboardFile(
      "components/app-sidebar.tsx",
    );

  assert.doesNotMatch(
    source,
    /title:\s*"Agents"/,
  );

  assert.doesNotMatch(
    source,
    /url:\s*"\/agents"/,
  );

  assert.match(
    source,
    /title:\s*"Teams"/,
  );
}

/**
 * Verifies the legacy Agents page redirects into the Team management workspace.
 */
function testLegacyAgentsRedirect(): void {
  const source =
    readDashboardFile(
      "app/agents/page.tsx",
    );

  assert.match(
    source,
    /redirect\(\s*"\/teams"\s*,?\s*\)/,
  );
}

testAgentsRemovedFromSidebar();
testLegacyAgentsRedirect();

console.log(
  "navigation contract tests passed",
);
