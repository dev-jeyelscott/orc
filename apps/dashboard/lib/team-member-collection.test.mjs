import assert from "node:assert/strict";
import test from "node:test";

import {
  appendTeamMemberAgentIds,
  getMembershipChangeCount,
  getTeamMemberCandidateAgents,
  getTeamMemberCandidateAvailability,
  getTeamMemberDepartmentOptions,
  getVisibleTeamMemberAgents,
  hasMembershipChanges,
  removeTeamMemberAgentId,
} from "./team-member-collection.ts";

/**
 * Builds the minimum Agent fixture required by Team-member presentation tests.
 */
function agent({
  id,
  name,
  departmentId,
  departmentName,
  currentTeamId = null,
  enabled = true,
}) {
  return {
    id,
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    departmentId,
    department: {
      id: departmentId,
      name: departmentName,
    },
    currentTeamId,
    enabled,
    effective: {
      role: `${departmentName} Specialist`,
      harness: "codex",
      model: "gpt-5",
      reasoning: "high",
      enabled,
    },
  };
}

const architecture = agent({
  id: "agent-architecture",
  name: "Atlas",
  departmentId: "department-architecture",
  departmentName: "Architecture",
  currentTeamId: "team-alpha",
});

const engineering = agent({
  id: "agent-engineering",
  name: "Forge",
  departmentId: "department-engineering",
  departmentName: "Engineering",
});

const engineeringAlternative = agent({
  id: "agent-engineering-alt",
  name: "Builder Two",
  departmentId: "department-engineering",
  departmentName: "Engineering",
});

const quality = agent({
  id: "agent-quality",
  name: "Verity",
  departmentId: "department-quality",
  departmentName: "Quality Assurance",
  currentTeamId: "team-alpha",
});

const securityElsewhere = agent({
  id: "agent-security",
  name: "Shield",
  departmentId: "department-security",
  departmentName: "Security",
  currentTeamId: "team-sigma",
});

test("filters current members by searchable Agent fields and Department", () => {
  const agents = [architecture, engineering, quality];

  assert.deepEqual(
    getVisibleTeamMemberAgents(
      agents,
      [architecture.id, engineering.id, quality.id],
      "engineering",
      "all",
    ).map((item) => item.id),
    [engineering.id],
  );

  assert.deepEqual(
    getVisibleTeamMemberAgents(
      agents,
      [architecture.id, engineering.id, quality.id],
      "",
      quality.departmentId,
    ).map((item) => item.id),
    [quality.id],
  );
});

test("candidate collection keeps another Team's Agent visible for an explicit disabled reason", () => {
  const candidates = getTeamMemberCandidateAgents(
    [architecture, engineering, securityElsewhere],
    [architecture.id],
  );

  assert.deepEqual(
    candidates.map((item) => item.id),
    [engineering.id, securityElsewhere.id],
  );

  assert.deepEqual(
    getTeamMemberCandidateAvailability(
      securityElsewhere,
      "team-alpha",
      [architecture],
      [],
    ),
    {
      disabled: true,
      reason: "Assigned to another Team",
    },
  );
});

test("candidate availability prevents a duplicate Department already represented in the Team", () => {
  assert.deepEqual(
    getTeamMemberCandidateAvailability(
      engineeringAlternative,
      "team-alpha",
      [engineering],
      [],
    ),
    {
      disabled: true,
      reason: "Engineering already represented",
    },
  );
});

test("candidate availability also prevents duplicate Departments inside pending multi-select", () => {
  assert.deepEqual(
    getTeamMemberCandidateAvailability(
      engineeringAlternative,
      "team-alpha",
      [architecture],
      [engineering],
    ),
    {
      disabled: true,
      reason: "Engineering already represented",
    },
  );
});

test("an Agent removed only from the draft may be selected again before save", () => {
  assert.deepEqual(
    getTeamMemberCandidateAvailability(
      architecture,
      "team-alpha",
      [],
      [],
    ),
    {
      disabled: false,
      reason: null,
    },
  );
});

test("Department filter options are unique and sorted", () => {
  assert.deepEqual(
    getTeamMemberDepartmentOptions([
      quality,
      engineering,
      engineeringAlternative,
      architecture,
    ]),
    [
      {
        id: architecture.departmentId,
        name: architecture.department.name,
      },
      {
        id: engineering.departmentId,
        name: engineering.department.name,
      },
      {
        id: quality.departmentId,
        name: quality.department.name,
      },
    ],
  );
});

test("membership change count includes additions and removals", () => {
  assert.equal(
    getMembershipChangeCount(
      [architecture.id, quality.id],
      [architecture.id, engineering.id],
    ),
    2,
  );

  assert.equal(
    hasMembershipChanges(
      [architecture.id, quality.id],
      [architecture.id, quality.id],
    ),
    false,
  );
});

test("multi-add and staged removal preserve unique Agent IDs", () => {
  const added = appendTeamMemberAgentIds(
    [architecture.id],
    [engineering.id, quality.id, engineering.id],
  );

  assert.deepEqual(
    added,
    [architecture.id, engineering.id, quality.id],
  );

  assert.deepEqual(
    removeTeamMemberAgentId(
      added,
      engineering.id,
    ),
    [architecture.id, quality.id],
  );
});
