import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

const createdRoots: string[] = [];

afterEach(async () => {
  vi.doUnmock("../config/env.js");
  vi.resetModules();
  for (const root of createdRoots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function makeConfigRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orc-status-test-"));
  createdRoots.push(root);
  return root;
}

describe("getConfigurationStatus", () => {
  it("reports valid for an empty but well-formed configuration root", async () => {
    const configRoot = await makeConfigRoot();
    vi.doMock("../config/env.js", () => ({ env: { ORC_CONFIG_ROOT: configRoot } }));

    const { getConfigurationStatus } = await import("./configuration-status-service.js");
    const status = await getConfigurationStatus();

    expect(status.state).toBe("valid");
    expect(status.configRoot).toBe(configRoot);
    expect(status.errorCount).toBe(0);
    expect(status.errors).toEqual([]);
  });

  it("reports invalid with bounded errors for a malformed configuration root", async () => {
    const configRoot = await makeConfigRoot();
    await fs.mkdir(path.join(configRoot, "departments/engineering"), { recursive: true });
    await fs.writeFile(
      path.join(configRoot, "departments/engineering/department.yaml"),
      stringifyYaml({ version: 1, slug: "engineering" }),
      "utf8",
    );

    vi.doMock("../config/env.js", () => ({ env: { ORC_CONFIG_ROOT: configRoot } }));

    const { getConfigurationStatus } = await import("./configuration-status-service.js");
    const status = await getConfigurationStatus();

    expect(status.state).toBe("invalid");
    expect(status.errorCount).toBeGreaterThan(0);
    expect(status.errors.length).toBeLessThanOrEqual(status.errorCount);
  });
});
