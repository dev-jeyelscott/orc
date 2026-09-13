import { execFile } from "node:child_process";

/**
 * Minimal read/write-agnostic Git command bridge shared by Knowledge ingestion (which only
 * ever reads vault state) and the Knowledge vault publisher (which commits approved
 * proposals). Kept separate from `knowledge-vault-fs.ts`, which is documented read-only.
 */

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 1024 * 1024;

/** Resolves the configured Knowledge vault root, or null when knowledge is not configured. */
export function getVaultRoot(): string | null {
  const root = process.env.KNOWLEDGE_VAULT_ROOT;

  return typeof root === "string" && root.trim().length > 0 ? root : null;
}

/** Runs one bounded `git` command against the configured vault root. */
export function runVaultGitCommand(vaultRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", vaultRoot, ...args],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

/** Reads the current Git HEAD commit of the configured vault. */
export async function getVaultHeadCommit(vaultRoot: string): Promise<string> {
  const sha = await runVaultGitCommand(vaultRoot, ["rev-parse", "HEAD"]);

  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("Unexpected rev-parse output");
  }

  return sha.toLowerCase();
}

/** Reads the vault's current working-tree status, optionally scoped to one path. */
export async function getVaultWorkingTreeStatus(vaultRoot: string, scopePath?: string): Promise<string> {
  const args = scopePath ? ["status", "--porcelain", "--", scopePath] : ["status", "--porcelain"];

  return runVaultGitCommand(vaultRoot, args);
}
