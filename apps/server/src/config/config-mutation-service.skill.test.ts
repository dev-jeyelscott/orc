import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigConflictError,
  ConfigReferentialError,
  deleteSkillFile,
  writeAgentFile,
  writeDepartmentFile,
  writeSkillFile,
} from "./config-mutation-service.js";
import type { AgentConfig, DepartmentConfig, SkillConfig } from "./schemas.js";

const createdRoots: string[] = [];

afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-mutation-skill-test-"));
  createdRoots.push(root);
  return root;
}

function skill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    version: 1,
    slug: "database-migrations",
    name: "Database Migrations",
    description: "Guidance for safe schema changes.",
    enabled: true,
    tags: ["database"],
    domains: ["backend"],
    ...overrides,
  };
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

describe("writeSkillFile", () => {
  it("writes skill.yaml and an optional SKILL.md, and refuses a duplicate slug", async () => {
    const root = await makeConfigRoot();

    const written = await writeSkillFile(root, skill(), "# Database Migrations\n\nFull instructions.", {
      previousSlug: null,
      expectedRevision: null,
    });

    expect(written.instructions).toContain("Full instructions");
    expect(await fs.readFile(path.join(root, "skills", "database-migrations", "skill.yaml"), "utf8")).toContain("slug: database-migrations");
    expect(await fs.readFile(path.join(root, "skills", "database-migrations", "SKILL.md"), "utf8")).toContain("Full instructions");

    await expect(
      writeSkillFile(root, skill(), null, { previousSlug: null, expectedRevision: null }),
    ).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("treats a blank instructions string as metadata-only (no SKILL.md written)", async () => {
    const root = await makeConfigRoot();
    const written = await writeSkillFile(root, skill(), "   ", { previousSlug: null, expectedRevision: null });
    expect(written.instructions).toBeNull();
    await expect(fs.readFile(path.join(root, "skills", "database-migrations", "SKILL.md"), "utf8")).rejects.toThrow();
  });

  it("rejects an update against a stale expectedRevision", async () => {
    const root = await makeConfigRoot();
    await writeSkillFile(root, skill(), null, { previousSlug: null, expectedRevision: null });

    await expect(
      writeSkillFile(root, skill({ description: "Updated" }), null, {
        previousSlug: "database-migrations",
        expectedRevision: "stale-hash",
      }),
    ).rejects.toBeInstanceOf(ConfigConflictError);
  });
});

describe("deleteSkillFile", () => {
  it("refuses to delete a Skill still assigned by an Agent file", async () => {
    const root = await makeConfigRoot();
    await writeDepartmentFile(root, department(), "prompt", { previousSlug: null, expectedRevision: null });
    await writeSkillFile(root, skill(), null, { previousSlug: null, expectedRevision: null });
    await writeAgentFile(root, agent({ skills: ["database-migrations"] }), "", { previousSlug: null, expectedRevision: null });

    await expect(deleteSkillFile(root, "database-migrations", null)).rejects.toBeInstanceOf(ConfigReferentialError);
  });

  it("deletes an unreferenced Skill's directory", async () => {
    const root = await makeConfigRoot();
    await writeSkillFile(root, skill(), null, { previousSlug: null, expectedRevision: null });

    expect(await deleteSkillFile(root, "database-migrations", null)).toBe(true);
    await expect(fs.stat(path.join(root, "skills", "database-migrations"))).rejects.toThrow();
  });
});
