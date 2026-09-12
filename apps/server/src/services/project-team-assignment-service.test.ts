import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ProjectTeamAssignmentError,
  canonicalProjectPath,
  validateProjectAutomationConfiguration,
} from "./project-team-assignment-service.js";

describe("Project Team assignment service", () => {
  it("uses one canonical absolute filesystem key for equivalent paths", () => {
    expect(canonicalProjectPath("/workspace/project/../project")).toBe("/workspace/project");
  });

  it("does not allow Project Auto Mode without its own Notion source", () => {
    expect(() => validateProjectAutomationConfiguration(true, null)).toThrow(ProjectTeamAssignmentError);
    expect(() => validateProjectAutomationConfiguration(true, null)).toThrow("A Notion data source ID is required when Auto Mode is enabled");
    expect(() => validateProjectAutomationConfiguration(false, null)).not.toThrow();
  });
});
