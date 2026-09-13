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
 * Verifies Agents is exposed as a top-level sidebar destination.
 */
function testAgentsInSidebar(): void {
  const source =
    readDashboardFile(
      "components/app-sidebar.tsx",
    );

  assert.match(
    source,
    /title:\s*"Agents"/,
  );

  assert.match(
    source,
    /url:\s*"\/agents"/,
  );

  assert.match(
    source,
    /title:\s*"Teams"/,
  );
}

/**
 * Verifies the Agent registry replaces the legacy redirect.
 */
function testAgentsRegistry(): void {
  const source =
    readDashboardFile(
      "app/agents/page.tsx",
    );

  assert.doesNotMatch(source, /redirect\(/);
  assert.match(source, /<AgentsManager/);
}

/**
 * Verifies Knowledge is exposed as a top-level sidebar destination.
 */
function testKnowledgeInSidebar(): void {
  const source =
    readDashboardFile(
      "components/app-sidebar.tsx",
    );

  assert.match(
    source,
    /title:\s*"Knowledge"/,
  );

  assert.match(
    source,
    /url:\s*"\/knowledge"/,
  );
}

/**
 * Verifies the Knowledge catalog and category workspace routes exist.
 */
function testKnowledgeRoutes(): void {
  const catalog =
    readDashboardFile(
      "app/knowledge/page.tsx",
    );

  assert.match(catalog, /<KnowledgeManager/);

  const detail =
    readDashboardFile(
      "app/knowledge/[categoryId]/page.tsx",
    );

  assert.match(detail, /<KnowledgeCategoryWorkspace/);
}

testAgentsInSidebar();
testAgentsRegistry();
testKnowledgeInSidebar();
testKnowledgeRoutes();

console.log(
  "navigation contract tests passed",
);
