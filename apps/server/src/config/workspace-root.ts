import path from "node:path";

import { env } from "./env.js";
import { loadConfigGraph } from "./loader.js";

/**
 * Resolves the durable workspace root (roadmap Vertical Spec 6, section
 * 15.1): `.orc/orc.yaml.workspaceRoot` when present, resolved relative to
 * the config root's parent directory (conventionally `~/orc/app`, never
 * `.orc/` itself), falling back to `WORKSPACE_ROOT` as a temporary
 * compatibility bootstrap value when no `orc.yaml` exists yet.
 */
export async function resolveWorkspaceRoot(configRoot: string = env.ORC_CONFIG_ROOT): Promise<string> {
  const graph = await loadConfigGraph(configRoot);
  const configuredRoot = graph.root?.data.workspaceRoot;

  if (!configuredRoot) {
    return env.WORKSPACE_ROOT;
  }

  return path.resolve(path.dirname(configRoot), configuredRoot);
}
