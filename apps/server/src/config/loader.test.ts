import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfigGraph } from "./loader.js";

const createdRoots: string[] = [];

afterEach(async () => {
  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-test-"));
  createdRoots.push(root);
  return root;
}

async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringifyYaml(data), "utf8");
}

function department(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    slug: "engineering",
    name: "Engineering",
    role: "Software Engineer",
    enabled: true,
    runtime: { harness: "codex", model: "default", reasoning: "high" },
    permissions: { write: true, commands: true, sandboxMode: "workspace-write", commit: false },
    ...overrides,
  };
}

function agent(overrides: Record<string, unknown> = {}) {
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

describe("loadConfigGraph", () => {
  it("accepts a valid minimal empty configuration tree", async () => {
    const root = await makeConfigRoot();

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(true);
    expect(graph.issues).toEqual([]);
    expect(graph.departments).toEqual([]);
  });

  it("loads a valid Department, Agent, and Skill with paired Markdown", async () => {
    const root = await makeConfigRoot();

    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department());
    await fs.writeFile(path.join(root, "departments/engineering/prompt.md"), "You are an engineer.", "utf8");

    await writeYaml(path.join(root, "skills/database-migrations/skill.yaml"), {
      version: 1,
      slug: "database-migrations",
      name: "Database Migrations",
      enabled: true,
      tags: ["database"],
      domains: ["backend"],
    });

    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent({ skills: ["database-migrations"] }));
    await fs.writeFile(path.join(root, "agents/backend-engineer/instructions.md"), "Extra instructions.", "utf8");

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(true);
    expect(graph.departments[0].prompt).toBe("You are an engineer.");
    expect(graph.agents[0].instructions).toBe("Extra instructions.");
    expect(graph.agents[0].data.skills).toEqual(["database-migrations"]);
  });

  it("reports malformed YAML as an issue instead of throwing", async () => {
    const root = await makeConfigRoot();
    await fs.mkdir(path.join(root, "departments/engineering"), { recursive: true });
    await fs.writeFile(path.join(root, "departments/engineering/department.yaml"), "slug: [unterminated", "utf8");

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes("Malformed YAML"))).toBe(true);
  });

  it("rejects an unsupported schema version", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department({ version: 2 }));

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.field === "version")).toBe(true);
  });

  it("rejects a duplicate slug across two Skill directories", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "skills/database-migrations/skill.yaml"), {
      version: 1,
      slug: "database-migrations",
      name: "Database Migrations",
      enabled: true,
    });
    // A differently named directory whose file claims the same slug.
    await writeYaml(path.join(root, "skills/database-migrations-2/skill.yaml"), {
      version: 1,
      slug: "database-migrations-2",
      name: "Database Migrations 2",
      enabled: true,
    });

    const graph = await loadConfigGraph(root);
    expect(graph.valid).toBe(true);

    // Now force an actual slug collision by mismatching one directory's own slug.
    await fs.rm(path.join(root, "skills/database-migrations-2"), { recursive: true });
    await writeYaml(path.join(root, "skills/database-migrations-2/skill.yaml"), {
      version: 1,
      slug: "database-migrations",
      name: "Duplicate",
      enabled: true,
    });

    const collided = await loadConfigGraph(root);
    expect(collided.valid).toBe(false);
    expect(collided.issues.some((issue) => issue.message.includes("must match its directory name"))).toBe(true);
  });

  it("rejects an Agent referencing a missing Department", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent());

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes('unknown Department "engineering"'))).toBe(true);
  });

  it("rejects an Agent referencing a missing Skill", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department());
    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent({ skills: ["missing-skill"] }));

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes('unknown Skill "missing-skill"'))).toBe(true);
  });

  it("rejects an Agent assigned to two Teams", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department());
    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent());
    await writeYaml(path.join(root, "teams/alpha/team.yaml"), {
      version: 1,
      slug: "alpha",
      name: "Alpha",
      enabled: true,
      members: ["backend-engineer"],
    });
    await writeYaml(path.join(root, "teams/beta/team.yaml"), {
      version: 1,
      slug: "beta",
      name: "Beta",
      enabled: true,
      members: ["backend-engineer"],
    });

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes("belongs to more than one Team"))).toBe(true);
  });

  it("rejects a duplicate Department inside one Team", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department());
    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent());
    await writeYaml(
      path.join(root, "agents/backend-engineer-2/agent.yaml"),
      agent({ slug: "backend-engineer-2", name: "Backend Engineer 2" }),
    );
    await writeYaml(path.join(root, "teams/alpha/team.yaml"), {
      version: 1,
      slug: "alpha",
      name: "Alpha",
      enabled: true,
      members: ["backend-engineer", "backend-engineer-2"],
    });

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(
      graph.issues.some((issue) => issue.message.includes("selects more than one Agent from Department")),
    ).toBe(true);
  });

  it("rejects a Project path that attempts traversal", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "teams/alpha/team.yaml"), {
      version: 1,
      slug: "alpha",
      name: "Alpha",
      enabled: true,
      members: [],
    });
    await writeYaml(path.join(root, "projects/evil.yaml"), {
      version: 1,
      slug: "evil",
      path: "../../etc/passwd",
      team: "alpha",
    });

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes("must not traverse outside"))).toBe(true);
  });

  it("rejects invalid workflow symbolic references", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "teams/alpha/team.yaml"), {
      version: 1,
      slug: "alpha",
      name: "Alpha",
      enabled: true,
      members: [],
    });
    await writeYaml(path.join(root, "teams/alpha/workflow.yaml"), {
      version: 1,
      published: null,
      draft: {
        nodes: [{ key: "start", kind: "start", position: { x: 0, y: 0 } }],
        edges: [{ source: "start", target: "does-not-exist" }],
      },
    });

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes("does not match any node key"))).toBe(true);
  });

  it("rejects a workflow Agent node that is not a Team member", async () => {
    const root = await makeConfigRoot();
    await writeYaml(path.join(root, "departments/engineering/department.yaml"), department());
    await writeYaml(path.join(root, "agents/backend-engineer/agent.yaml"), agent());
    await writeYaml(path.join(root, "teams/alpha/team.yaml"), {
      version: 1,
      slug: "alpha",
      name: "Alpha",
      enabled: true,
      members: [],
    });
    await writeYaml(path.join(root, "teams/alpha/workflow.yaml"), {
      version: 1,
      published: null,
      draft: {
        nodes: [
          { key: "start", kind: "start", position: { x: 0, y: 0 } },
          { key: "agent:backend-engineer", kind: "agent", agent: "backend-engineer", position: { x: 0, y: 100 } },
        ],
        edges: [{ source: "start", target: "agent:backend-engineer" }],
      },
    });

    const graph = await loadConfigGraph(root);

    expect(graph.valid).toBe(false);
    expect(graph.issues.some((issue) => issue.message.includes("is not a member of Team"))).toBe(true);
  });
});
