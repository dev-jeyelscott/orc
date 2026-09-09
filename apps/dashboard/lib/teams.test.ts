import assert from "node:assert/strict";

import {
  getTeamAutomationValidationError,
  missingNotionDataSourceMessage,
  normalizeTeamAutomationInput,
} from "./teams";

const baseTeam = {
  slug:
    "platform",
  name:
    "Platform Team",
  description:
    "",
  enabled:
    true,
  notionDataSourceId:
    "  notion-platform-source  ",
  autoModeEnabled:
    true,
};

/**
 * Verifies blank dashboard input becomes the nullable Team API contract.
 */
function testTeamAutomationNormalization(): void {
  assert.deepEqual(
    normalizeTeamAutomationInput(
      baseTeam,
    ),
    {
      ...baseTeam,
      notionDataSourceId:
        "notion-platform-source",
    },
  );

  assert.equal(
    normalizeTeamAutomationInput({
      ...baseTeam,
      notionDataSourceId:
        "   ",
      autoModeEnabled:
        false,
    }).notionDataSourceId,
    null,
  );
}

/**
 * Verifies client feedback matches the server-side Auto Mode requirement.
 */
function testTeamAutomationValidation(): void {
  assert.equal(
    getTeamAutomationValidationError({
      autoModeEnabled:
        true,
      notionDataSourceId:
        null,
    }),
    missingNotionDataSourceMessage,
  );

  assert.equal(
    getTeamAutomationValidationError({
      autoModeEnabled:
        true,
      notionDataSourceId:
        "notion-platform-source",
    }),
    null,
  );

  assert.equal(
    getTeamAutomationValidationError({
      autoModeEnabled:
        false,
      notionDataSourceId:
        null,
    }),
    null,
  );
}

testTeamAutomationNormalization();
testTeamAutomationValidation();

console.log(
  "team client helper tests passed",
);
