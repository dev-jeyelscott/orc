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
 * Verifies Skills uses the collection registry instead of its legacy inline form.
 */
function testSkillsRegistryContract(): void {
  const source =
    readDashboardFile(
      "components/skills-manager.tsx",
    );

  assert.match(
    source,
    /SkillConfigDrawer/,
  );

  assert.doesNotMatch(
    source,
    /<form/,
  );

  assert.match(
    source,
    /Search Skills/,
  );

  assert.match(
    source,
    /Create Skill/,
  );

  assert.match(
    source,
    /All statuses/,
  );

  assert.match(
    source,
    /SKILL_VIEW_MODES/,
  );

  assert.match(
    source,
    /No matching Skills/,
  );

  assert.match(
    source,
    /Failed to load Skills/,
  );
}

/**
 * Verifies Skill editing uses the established non-modal right Drawer contract.
 */
function testSkillDrawerContract(): void {
  const source =
    readDashboardFile(
      "components/skill-config-drawer.tsx",
    );

  assert.match(
    source,
    /modal=\{false\}/,
  );

  assert.match(
    source,
    /swipeDirection="right"/,
  );

  for (const label of [
    "Name",
    "Slug",
    "Description",
    "Enabled",
    "Cancel",
    "Save Skill",
  ]) {
    assert.match(
      source,
      new RegExp(
        label,
      ),
    );
  }

  assert.match(
    source,
    /Skill enabled/,
  );

  assert.match(
    source,
    /role="alert"/,
  );
}

testSkillsRegistryContract();
testSkillDrawerContract();

console.log(
  "Skills UI contract tests passed",
);
