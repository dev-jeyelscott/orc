import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigConflictError,
  ConfigReferentialError,
  ConfigValidationError,
  deleteAgentFile,
  deleteDepartmentFile,
  writeAgentFile,
  writeDepartmentFile,
} from "./config-mutation-service.js";
import type { AgentConfig, DepartmentConfig } from "./schemas.js";

const createdRoots: string[] = [];

afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-mutation-test-"));
  createdRoots.push(root);
  return root;
}

function department(overrides: Partial<DepartmentConfig> = {}): DepartmentConfig {
  return {
    version: 1,
    slug: "engineering",
    name: "Engineering",
    role: "Software Engineer",
    description: "",
    enabled: true,
    runtime: { harness: "codex", model: "default", reasoning: "high" },
    permissions: { write: true, commands: true, sandboxMode: "workspace-write", commit: false },
    ...overrides,
  };
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    version: 1,
    slug: "backend-engineer",
    name: "Backend Engineer",
    department: "engineering",
    enabled: true,
    runtime: { harness: null, model: null, reasoning: null },
    permissions: { write: null, commands: null, sandboxMode: null, commit: null },
    skills: [],
    ...overrides,
  };
}

describe("writeDepartmentFile", () => {
  it("creates a Department file and returns its revision", async () => {
    const root = await makeConfigRoot();

    const written = await writeDepartmentFile(root, department(), "You are an engineer.", {
      previousSlug: null,
      expectedRevision: null,
    });

    expect(written.configRevision).toMatch(/^[0-9a-f]{64}$/);
    const yaml = await fs.readFile(path.join(root, "departments/engineering/department.yaml"), "utf8");
    expect(yaml).toContain("slug: engineering");
    const prompt = await fs.readFile(path.join(root, "departments/engineering/prompt.md"), "utf8");
    expect(prompt).toBe("You are an engineer.");
  });

  it("refuses to create a Department that already exists", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });

    await expect(
      writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null }),
    ).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("rejects an update against a stale expected revision", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });

    await expect(
      writeDepartmentFile(root, department({ name: "Renamed" }), "prompt", {
        previousSlug: "engineering",
        expectedRevision: "stale-hash",
      }),
    ).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("accepts an update against the current expected revision and moves the directory on rename", async () => {
    const root = await makeConfigRoot();
    const created = await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });

    const renamed = await writeDepartmentFile(root, department({ slug: "eng" }), "prompt", {
      previousSlug: "engineering",
      expectedRevision: created.configRevision,
    });

    expect(renamed.data.slug).toBe("eng");
    await expect(fs.stat(path.join(root, "departments/engineering"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "departments/eng/department.yaml"))).resolves.toBeDefined();
  });

  it("rejects renaming a Department out from under a referencing Agent", async () => {
    const root = await makeConfigRoot();
    const created = await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });
    await writeAgentFile(root, agent(), "instructions", { previousSlug: null, expectedRevision: null });

    await expect(
      writeDepartmentFile(root, department({ slug: "renamed-department" }), "prompt", {
        previousSlug: "engineering",
        expectedRevision: created.configRevision,
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
  });
});

describe("deleteDepartmentFile", () => {
  it("returns false for a Department that does not exist", async () => {
    const root = await makeConfigRoot();
    expect(await deleteDepartmentFile(root, "missing", null)).toBe(false);
  });

  it("refuses to delete a Department still referenced by an Agent", async () => {
    const root = await makeConfigRoot();
    const written = await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });
    await writeAgentFile(root, agent(), "instructions", { previousSlug: null, expectedRevision: null });

    await expect(deleteDepartmentFile(root, "engineering", written.configRevision)).rejects.toBeInstanceOf(
      ConfigReferentialError,
    );
  });

  it("deletes an unreferenced Department", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });

    expect(await deleteDepartmentFile(root, "engineering", null)).toBe(true);
    await expect(fs.stat(path.join(root, "departments/engineering"))).rejects.toThrow();
  });
});

describe("writeAgentFile", () => {
  it("rejects an Agent referencing an unknown Department", async () => {
    const root = await makeConfigRoot();

    await expect(
      writeAgentFile(root, agent(), "instructions", { previousSlug: null, expectedRevision: null }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it("creates an Agent once its Department exists", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });

    const written = await writeAgentFile(root, agent(), "instructions", { previousSlug: null, expectedRevision: null });

    expect(written.configRevision).toMatch(/^[0-9a-f]{64}$/);
    const instructions = await fs.readFile(path.join(root, "agents/backend-engineer/instructions.md"), "utf8");
    expect(instructions).toBe("instructions");
  });
});

describe("deleteAgentFile", () => {
  it("deletes an existing Agent file", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });
    await writeAgentFile(root, agent(), "instructions", { previousSlug: null, expectedRevision: null });

    expect(await deleteAgentFile(root, "backend-engineer", null)).toBe(true);
    await expect(fs.stat(path.join(root, "agents/backend-engineer"))).rejects.toThrow();
  });
});
