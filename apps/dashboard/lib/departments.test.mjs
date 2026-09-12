import assert from "node:assert/strict";

import {
  createDepartment,
  deleteDepartment,
  getDepartments,
  updateDepartment,
} from "./departments.ts";

const department = {
  id: "00000000-0000-4000-9000-000000000097",
  slug: "platform",
  name: "Platform",
  role: "Platform Engineer",
  description: "",
  enabled: true,
  harness: "codex",
  defaultModel: "default",
  defaultReasoning: "high",
  systemPrompt: "Maintain the platform.",
  canWrite: true,
  canRunCommands: true,
  sandboxMode: "workspace-write",
  canCommit: false,
  agentCount: 0,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push([String(url), options]);
  return new Response(
    JSON.stringify(String(url).endsWith("/api/departments") && !options.method
      ? { departments: [department] }
      : department),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

try {
  assert.deepEqual(await getDepartments(), [department]);
  assert.equal((await createDepartment(department)).id, department.id);
  assert.equal((await updateDepartment(department.id, { enabled: false })).id, department.id);
  await deleteDepartment(department.id);
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[2][1].method, "PATCH");
  assert.equal(calls[3][1].method, "DELETE");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("department dashboard API client tests passed");
