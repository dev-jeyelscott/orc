import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDepartmentSchema,
  departmentSchema,
  updateDepartmentSchema,
} from "./department.js";

const DEPARTMENT_ID =
  "00000000-0000-4000-9000-000000009998";

const validDepartment = {
  slug: "platform-engineering",
  name: "Platform Engineering",
  role: "Platform Engineer",
  harness: "codex",
  defaultModel: "default",
  defaultReasoning: "high",
  systemPrompt: "Maintain the platform.",
};

describe("Department DTO contracts", () => {
  it("accepts complete reusable runtime defaults", () => {
    expect(createDepartmentSchema.parse(validDepartment)).toEqual({
      ...validDepartment,
      description: "",
      enabled: true,
      canWrite: false,
      canRunCommands: false,
      canCommit: false,
    });
  });

  it("rejects missing runtime defaults and invalid slugs", () => {
    expect(createDepartmentSchema.safeParse({
      ...validDepartment,
      slug: "Platform Engineering",
    }).success).toBe(false);
    expect(createDepartmentSchema.safeParse({
      ...validDepartment,
      systemPrompt: "   ",
    }).success).toBe(false);
  });

  it("keeps updates partial and validates persisted responses", () => {
    expect(updateDepartmentSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });

    expect(departmentSchema.parse({
      ...validDepartment,
      id: DEPARTMENT_ID,
      description: "",
      enabled: true,
      canWrite: false,
      canRunCommands: true,
      sandboxMode: "workspace-write",
      canCommit: false,
      agentCount: 0,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    }).agentCount).toBe(0);
  });
});
