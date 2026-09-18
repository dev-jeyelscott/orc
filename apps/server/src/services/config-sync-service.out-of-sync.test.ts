import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const outOfSyncMocks = vi.hoisted(() => ({ failNextDepartmentSync: false }));

// A valid `.orc/` graph must still mark configuration out-of-sync when its
// projection fails partway through (roadmap invariant #4). Real DB failures
// are awkward to force deterministically, so this intercepts one real
// projection-sync call to fail exactly once and otherwise delegates to the
// actual implementation.
vi.mock("../config/projection-sync.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/projection-sync.js")>();
  return {
    ...actual,
    syncDepartmentProjection: async (...args: Parameters<typeof actual.syncDepartmentProjection>) => {
      if (outOfSyncMocks.failNextDepartmentSync) {
        outOfSyncMocks.failNextDepartmentSync = false;
        throw new Error("simulated projection failure");
      }
      return actual.syncDepartmentProjection(...args);
    },
  };
});

import { eq } from "drizzle-orm";

import { clearConfigOutOfSync, getConfigOutOfSyncState } from "../config/health-state.js";
import { db } from "../db/client.js";
import { departments } from "../db/schema.js";
import { synchronizeConfiguration } from "./config-sync-service.js";
import { getConfigurationReadiness } from "./configuration-status-service.js";

const createdDepartmentSlugs = new Set<string>();
const createdRoots: string[] = [];

function departmentYaml(slug: string): string {
  return [
    "version: 1",
    `slug: ${slug}`,
    "name: Out Of Sync Department",
    "role: Engineer",
    "enabled: true",
    "runtime:",
    "  harness: codex",
    "  model: default",
    "  reasoning: high",
    "permissions:",
    "  write: true",
    "  commands: true",
    "  sandboxMode: workspace-write",
    "  commit: false",
    "",
  ].join("\n");
}

async function makeValidConfigRoot(slug: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-sync-oos-"));
  createdRoots.push(root);
  const dir = path.join(root, "departments", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "department.yaml"), departmentYaml(slug), "utf8");
  return root;
}

afterEach(async () => {
  for (const slug of createdDepartmentSlugs) {
    await db.delete(departments).where(eq(departments.slug, slug));
  }
  createdDepartmentSlugs.clear();
  outOfSyncMocks.failNextDepartmentSync = false;
  clearConfigOutOfSync();

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("config-sync-service degraded-mode readiness (roadmap invariant #4)", () => {
  it("marks configuration out_of_sync when projection fails against a valid canonical graph, blocks readiness, and a later successful sync restores it", async () => {
    const slug = `config-sync-oos-${crypto.randomUUID()}`;
    createdDepartmentSlugs.add(slug);
    const root = await makeValidConfigRoot(slug);

    outOfSyncMocks.failNextDepartmentSync = true;

    await expect(synchronizeConfiguration(root)).rejects.toThrow("simulated projection failure");
    expect(getConfigOutOfSyncState()).not.toBeNull();
    expect(await getConfigurationReadiness()).toMatchObject({ ready: false });

    const result = await synchronizeConfiguration(root);
    expect(result.status).toBe("synced");
    expect(getConfigOutOfSyncState()).toBeNull();
    expect(await getConfigurationReadiness()).toMatchObject({ ready: true });

    const [row] = await db.select().from(departments).where(eq(departments.slug, slug));
    expect(row).toBeDefined();
  });

  it("reports invalid, not out_of_sync, for a malformed canonical graph", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-sync-oos-invalid-"));
    createdRoots.push(root);
    await fs.mkdir(path.join(root, "departments", "broken"), { recursive: true });
    await fs.writeFile(path.join(root, "departments", "broken", "department.yaml"), "slug: [this is not valid\n", "utf8");

    const result = await synchronizeConfiguration(root);
    expect(result.status).toBe("invalid");
    expect(getConfigOutOfSyncState()).toBeNull();
  });
});
