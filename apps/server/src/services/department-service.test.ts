import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "../db/client.js";
import { agents, departments } from "../db/schema.js";
import { createDepartment, deleteDepartment, getDepartment, listDepartments, updateDepartment } from "./department-service.js";
import { createAgent, deleteAgent } from "./agent-service.js";

const createdIds = new Set<string>();
const createdAgentIds = new Set<string>();
const createdRoots: string[] = [];

const input = (label: string) => ({
  slug: `department-${label}-${crypto.randomUUID()}`, name: `Department ${label}`,
  role: "Engineer", harness: "codex" as const, defaultModel: "default",
  defaultReasoning: "high", systemPrompt: "Perform engineering work.",
  canWrite: true, canRunCommands: true, canCommit: false,
});

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-department-service-test-"));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const id of createdAgentIds) await db.delete(agents).where(eq(agents.id, id));
  createdAgentIds.clear();
  for (const id of createdIds) await db.delete(departments).where(eq(departments.id, id));
  createdIds.clear();
  for (const root of createdRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("department-service", () => {
  it("persists create, list, get, update, enablement, and deletion", async () => {
    const root = await makeConfigRoot();
    const created = await createDepartment(input("lifecycle"), root); createdIds.add(created.id);
    expect(created.enabled).toBe(true); expect(created.agentCount).toBe(0);
    expect(created.configRevision).toMatch(/^[0-9a-f]{64}$/);
    expect((await getDepartment(created.id, root))?.id).toBe(created.id);
    expect((await listDepartments(root)).some((item) => item.id === created.id)).toBe(true);

    const disabled = await updateDepartment(created.id, { enabled: false }, created.configRevision, root);
    expect(disabled?.enabled).toBe(false);

    expect(await deleteDepartment(created.id, disabled!.configRevision, root)).toBe(true);
    createdIds.delete(created.id);
    expect(await getDepartment(created.id, root)).toBeNull();
  });

  it("returns a stable conflict for duplicate slugs", async () => {
    const root = await makeConfigRoot();
    const values = input("unique");
    const created = await createDepartment(values, root); createdIds.add(created.id);
    await expect(createDepartment({ ...values, name: "Another Department" }, root)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects an update against a stale configRevision", async () => {
    const root = await makeConfigRoot();
    const created = await createDepartment(input("stale"), root); createdIds.add(created.id);

    await expect(
      updateDepartment(created.id, { enabled: false }, "not-the-current-revision", root),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reports a real Agent count and rejects deletion while a canonical Agent file references it", async () => {
    const root = await makeConfigRoot();
    const department = await createDepartment(input("referenced"), root); createdIds.add(department.id);

    const agent = await createAgent(
      {
        departmentId: department.id,
        slug: `department-referenced-agent-${crypto.randomUUID()}`,
        name: "Referenced Agent",
        enabled: true,
        additionalPrompt: "",
      },
      root,
    );
    createdAgentIds.add(agent.id);

    expect((await getDepartment(department.id, root))?.agentCount).toBe(1);
    expect((await listDepartments(root)).find((item) => item.id === department.id)?.agentCount).toBe(1);

    await expect(deleteDepartment(department.id, department.configRevision, root)).rejects.toMatchObject({ statusCode: 409 });

    expect(await deleteAgent(agent.id, agent.configRevision, root)).toBe(true);
    createdAgentIds.delete(agent.id);

    expect(await deleteDepartment(department.id, department.configRevision, root)).toBe(true);
    createdIds.delete(department.id);
  });
});
