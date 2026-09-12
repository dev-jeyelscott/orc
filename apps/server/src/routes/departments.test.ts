import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDepartment: vi.fn(), deleteDepartment: vi.fn(), getDepartment: vi.fn(),
  listDepartments: vi.fn(), updateDepartment: vi.fn(),
}));

vi.mock("../services/department-service.js", () => ({
  DepartmentServiceError: class DepartmentServiceError extends Error {
    constructor(message: string, readonly statusCode: number) { super(message); }
  },
  ...mocks,
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
beforeEach(async () => { Object.values(mocks).forEach((mock) => mock.mockReset()); app = Fastify(); await app.register(departmentRoutes); });
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
});
