import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Verifies blank dashboard input becomes the nullable Team API contract.
 */
function testTeamAutomationIsProjectScoped(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const teamsSource = readFileSync(resolve(root, "components/teams-manager.tsx"), "utf8");
  const editorSource = readFileSync(resolve(root, "components/project-assignment-editor.tsx"), "utf8");

  assert.doesNotMatch(teamsSource, /TeamAutoModeBadge|notionDataSourceId|autoModeEnabled/);
  assert.match(editorSource, /Notion Data Source ID/);
  assert.match(editorSource, /Auto Mode/);
}

testTeamAutomationIsProjectScoped();

console.log(
  "team client helper tests passed",
);
