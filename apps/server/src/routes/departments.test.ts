import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDepartment: vi.fn(), deleteDepartment: vi.fn(), getDepartment: vi.fn(),
  listDepartments: vi.fn(), updateDepartment: vi.fn(),
}));

const knowledgeMocks = vi.hoisted(() => ({
  listDepartmentKnowledge: vi.fn(), replaceDepartmentKnowledge: vi.fn(),
}));

vi.mock("../services/department-service.js", () => ({
  DepartmentServiceError: class DepartmentServiceError extends Error {
    constructor(message: string, readonly statusCode: number) { super(message); }
  },
  ...mocks,
}));

vi.mock("../services/department-knowledge-service.js", () => ({
  DepartmentKnowledgeServiceError: class DepartmentKnowledgeServiceError extends Error {
    constructor(message: string, readonly statusCode: number) { super(message); }
  },
  ...knowledgeMocks,
}));

const { DepartmentServiceError } = await import("../services/department-service.js");
const { departmentRoutes } = await import("./departments.js");

const DEPARTMENT_ID = "00000000-0000-4000-9000-000000000098";
const department = {
  id: DEPARTMENT_ID, slug: "platform", name: "Platform", role: "Platform Engineer",
  description: "", enabled: true, harness: "codex", defaultModel: "default",
  defaultReasoning: "high", systemPrompt: "Maintain the platform.", canWrite: true,
  canRunCommands: true, sandboxMode: "workspace-write", canCommit: false, agentCount: 0,
  createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z",
};

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  Object.values(knowledgeMocks).forEach((mock) => mock.mockReset());
  app = Fastify();
  await app.register(departmentRoutes);
});
afterEach(async () => { await app.close(); });

describe("Department routes", () => {
  it("supports create, list, get, update, and delete", async () => {
    mocks.createDepartment.mockResolvedValue(department);
    mocks.listDepartments.mockResolvedValue([department]);
    mocks.getDepartment.mockResolvedValue(department);
    mocks.updateDepartment.mockResolvedValue({ ...department, enabled: false });
    mocks.deleteDepartment.mockResolvedValue(true);

    const payload = {
      slug: department.slug, name: department.name, role: department.role,
      harness: department.harness, defaultModel: department.defaultModel,
      defaultReasoning: department.defaultReasoning, systemPrompt: department.systemPrompt,
      canWrite: true, canRunCommands: true, canCommit: false,
    };
    expect((await app.inject({ method: "POST", url: "/api/departments", payload })).statusCode).toBe(201);
    expect(mocks.createDepartment).toHaveBeenCalledWith(expect.objectContaining(payload));
    expect((await app.inject({ method: "GET", url: "/api/departments" })).json()).toEqual({ departments: [department] });
    expect((await app.inject({ method: "GET", url: `/api/departments/${DEPARTMENT_ID}` })).json()).toEqual(department);
    expect((await app.inject({ method: "PATCH", url: `/api/departments/${DEPARTMENT_ID}`, payload: { enabled: false } })).json()).toEqual({ ...department, enabled: false });
    expect((await app.inject({ method: "DELETE", url: `/api/departments/${DEPARTMENT_ID}` })).statusCode).toBe(204);
  });

  it("returns stable validation, absent, and conflict responses", async () => {
    expect((await app.inject({ method: "POST", url: "/api/departments", payload: {} })).statusCode).toBe(400);
    mocks.getDepartment.mockResolvedValue(null);
    expect((await app.inject({ method: "GET", url: `/api/departments/${DEPARTMENT_ID}` })).json()).toEqual({ error: "department_not_found" });
    mocks.deleteDepartment.mockRejectedValue(new DepartmentServiceError("Department cannot be deleted because agents still reference it", 409));
    const response = await app.inject({ method: "DELETE", url: `/api/departments/${DEPARTMENT_ID}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Department cannot be deleted because agents still reference it" });
  });

  it("supports reading and replacing primary Knowledge Category associations", async () => {
    const association = {
      knowledgeCategoryId: "00000000-0000-4000-9000-000000000099",
      slug: "ui-ux", name: "UI/UX Guidelines", enabled: true, isPrimary: true,
    };
    mocks.getDepartment.mockResolvedValue(department);
    knowledgeMocks.listDepartmentKnowledge.mockResolvedValue([association]);
    knowledgeMocks.replaceDepartmentKnowledge.mockResolvedValue([association]);

    const getResponse = await app.inject({ method: "GET", url: `/api/departments/${DEPARTMENT_ID}/knowledge` });
    expect(getResponse.json()).toEqual({ knowledge: [association] });

    const putResponse = await app.inject({
      method: "PUT",
      url: `/api/departments/${DEPARTMENT_ID}/knowledge`,
      payload: { knowledgeCategoryIds: [association.knowledgeCategoryId] },
    });
    expect(putResponse.json()).toEqual({ knowledge: [association] });
    expect(knowledgeMocks.replaceDepartmentKnowledge).toHaveBeenCalledWith(
      DEPARTMENT_ID,
      [association.knowledgeCategoryId],
    );
  });

  it("returns department_not_found for knowledge association reads on an absent Department", async () => {
    mocks.getDepartment.mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: `/api/departments/${DEPARTMENT_ID}/knowledge` });
    expect(response.json()).toEqual({ error: "department_not_found" });
    expect(knowledgeMocks.listDepartmentKnowledge).not.toHaveBeenCalled();
  });

  it("rejects an invalid Knowledge Category id in a replace request", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/departments/${DEPARTMENT_ID}/knowledge`,
      payload: { knowledgeCategoryIds: ["not-a-uuid"] },
    });
    expect(response.statusCode).toBe(400);
    expect(knowledgeMocks.replaceDepartmentKnowledge).not.toHaveBeenCalled();
  });
});
