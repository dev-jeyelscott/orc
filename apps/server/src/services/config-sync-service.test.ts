import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { clearConfigOutOfSync, getConfigOutOfSyncState, markConfigOutOfSync } from "../config/health-state.js";
import { db } from "../db/client.js";
import { agents, departments, teamMembers, teams } from "../db/schema.js";
import { createAgent } from "./agent-service.js";
import { getConfigRemovalCandidates, synchronizeConfiguration } from "./config-sync-service.js";
import { getConfigurationReadiness } from "./configuration-status-service.js";
import { createDepartment } from "./department-service.js";
import { replaceTeamMembers } from "./team-membership.js";
import { createTeam } from "./team-service.js";

// Tracked by slug, not id: `synchronizeConfiguration` can reproject a
// resource under a brand-new row id (e.g. after a test drops the original
// row to simulate a fresh database), so cleanup must not rely on the id
// captured at creation time -- doing so silently orphaned rows in the
// shared dev database in an earlier version of this test.
const createdDepartmentSlugs = new Set<string>();
const createdAgentSlugs = new Set<string>();
const createdTeamSlugs = new Set<string>();
const createdRoots: string[] = [];

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-config-sync-test-"));
  createdRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const slug of createdTeamSlugs) {
    const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, slug));
    if (team) {
      await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
      await db.delete(teams).where(eq(teams.id, team.id));
    }
  }
  for (const slug of createdAgentSlugs) {
    await db.delete(agents).where(eq(agents.slug, slug));
  }
  for (const slug of createdDepartmentSlugs) {
    await db.delete(departments).where(eq(departments.slug, slug));
  }
  createdTeamSlugs.clear();
  createdAgentSlugs.clear();
  createdDepartmentSlugs.clear();
  clearConfigOutOfSync();

  for (const root of createdRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("config-sync-service (Vertical Spec 7)", () => {
  it("reconstructs the full projection from .orc/ after simulating a fresh database", async () => {
    const root = await makeConfigRoot();
    const suffix = crypto.randomUUID();

    const department = await createDepartment(
      {
        slug: `config-sync-${suffix}`,
        name: "Config Sync Department",
        role: "Engineer",
        harness: "codex" as const,
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Act as a config sync test department.",
      },
      root,
    );
    createdDepartmentSlugs.add(department.slug);

    const agent = await createAgent(
      {
        departmentId: department.id,
        slug: `config-sync-agent-${suffix}`,
        name: "Config Sync Agent",
        enabled: true,
        additionalPrompt: "",
      },
      root,
    );
    createdAgentSlugs.add(agent.slug);

    const team = await createTeam(
      { slug: `config-sync-team-${suffix}`, name: "Config Sync Team", description: "", enabled: true },
      root,
    );
    createdTeamSlugs.add(team.slug);
    await replaceTeamMembers(team.id, [agent.id], null, root);

    // Simulate a fresh database: drop every projection row this file tree describes.
    await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
    await db.delete(teams).where(eq(teams.id, team.id));
    await db.delete(agents).where(eq(agents.id, agent.id));
    await db.delete(departments).where(eq(departments.id, department.id));

    expect(await db.select().from(departments).where(eq(departments.slug, department.slug))).toHaveLength(0);

    const result = await synchronizeConfiguration(root);
    expect(result.status).toBe("synced");

    const [reprojectedDepartment] = await db.select().from(departments).where(eq(departments.slug, department.slug));
    expect(reprojectedDepartment).toBeDefined();

    const [reprojectedAgent] = await db.select().from(agents).where(eq(agents.slug, agent.slug));
    expect(reprojectedAgent).toBeDefined();

    const [reprojectedTeam] = await db.select().from(teams).where(eq(teams.slug, team.slug));
    expect(reprojectedTeam).toBeDefined();

    const memberRows = await db.select().from(teamMembers).where(eq(teamMembers.teamId, reprojectedTeam.id));
    expect(memberRows.some((row) => row.agentId === reprojectedAgent.id)).toBe(true);
  });

  it("refuses to sync an invalid graph and performs no projection", async () => {
    const root = await makeConfigRoot();
    await fs.mkdir(path.join(root, "departments", "broken"), { recursive: true });
    await fs.writeFile(path.join(root, "departments", "broken", "department.yaml"), "slug: [this is not valid\n", "utf8");

    const result = await synchronizeConfiguration(root);
    expect(result.status).toBe("invalid");
  });

  it("is idempotent -- syncing twice in a row produces the same projection", async () => {
    const root = await makeConfigRoot();
    const department = await createDepartment(
      {
        slug: `config-sync-idempotent-${crypto.randomUUID()}`,
        name: "Idempotent Department",
        role: "Engineer",
        harness: "codex" as const,
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Idempotent sync test.",
      },
      root,
    );
    createdDepartmentSlugs.add(department.slug);

    const first = await synchronizeConfiguration(root);
    const second = await synchronizeConfiguration(root);
    expect(first).toEqual(second);
  });

  it("serializes concurrent sync attempts into one in-flight run", async () => {
    const root = await makeConfigRoot();
    const [a, b] = await Promise.all([synchronizeConfiguration(root), synchronizeConfiguration(root)]);
    expect(a).toEqual(b);
  });

  it("reports a removal candidate for a projected resource whose canonical file is missing", async () => {
    const root = await makeConfigRoot();
    const department = await createDepartment(
      {
        slug: `config-sync-removal-${crypto.randomUUID()}`,
        name: "Removal Candidate Department",
        role: "Engineer",
        harness: "codex" as const,
        defaultModel: "default",
        defaultReasoning: "high",
        systemPrompt: "Removal candidate test.",
      },
      root,
    );
    createdDepartmentSlugs.add(department.slug);

    await fs.rm(path.join(root, "departments", department.slug), { recursive: true, force: true });

    const candidates = await getConfigRemovalCandidates(root);
    expect(candidates).toContainEqual({ resourceType: "department", slug: department.slug });

    // The DB row must still exist -- reporting a candidate is not deleting it.
    expect(await db.select().from(departments).where(eq(departments.slug, department.slug))).toHaveLength(1);
  });

  it("clearing out-of-sync state restores readiness for new work", async () => {
    markConfigOutOfSync({ reason: "test", resourceType: "department", resourceId: "test" });
    expect(await getConfigurationReadiness()).toMatchObject({ ready: false });
    expect(getConfigOutOfSyncState()).not.toBeNull();

    clearConfigOutOfSync();
    expect(await getConfigurationReadiness()).toMatchObject({ ready: true });
  });
});
