import { env } from "../config/env.js";
import { queryClient } from "../db/client.js";
import { ConfigExportError, exportConfigFromDatabase } from "./export.js";

/** Reads `--out=<path>` (or `--out <path>`) from CLI args, defaulting to `ORC_CONFIG_ROOT`. */
function resolveOutputRoot(argv: string[]): string {
  const inlineArg = argv.find((arg) => arg.startsWith("--out="));
  if (inlineArg) {
    return inlineArg.slice("--out=".length);
  }

  const flagIndex = argv.indexOf("--out");
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }

  return env.ORC_CONFIG_ROOT;
}

/**
 * `pnpm config:export` -- one-time PostgreSQL -> `.orc/` exporter. Never
 * mutates the database; refuses to silently overwrite existing canonical
 * files; validates the exported tree before reporting success.
 */
async function main() {
  const outputRoot = resolveOutputRoot(process.argv.slice(2));

  try {
    const result = await exportConfigFromDatabase({
      outputRoot,
      workspaceRoot: env.WORKSPACE_ROOT,
    });

    console.log(`Exported ${result.filesWritten.length} file(s) to ${result.outputRoot}`);

    if (!result.validation.valid) {
      console.log(`Exported tree failed validation with ${result.validation.issues.length} issue(s):`);
      for (const issue of result.validation.issues) {
        console.log(`- [${issue.resourceType}${issue.resourceId ? `:${issue.resourceId}` : ""}] ${issue.filePath}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Exported tree validated successfully.");
  } catch (error) {
    if (error instanceof ConfigExportError) {
      console.error(`Export refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await queryClient.end();
  }
}

main().catch((error) => {
  console.error("Configuration export failed to run:", error);
  process.exitCode = 1;
});
