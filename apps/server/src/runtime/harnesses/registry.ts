import type { Harness } from "@orc/shared";

import type { HarnessAdapter } from "../contracts.js";
import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";

const adapters: Record<Harness, HarnessAdapter> = {
  claude: claudeHarness,
  codex: codexHarness,
};

export function getHarnessAdapter(harness: Harness): HarnessAdapter {
  return adapters[harness];
}
