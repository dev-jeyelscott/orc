import {
  readdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";

import type { KnowledgeCategoryFile } from "@orc/shared";

/**
 * Narrowly scoped, read-only filesystem bridge used only for browsing the Markdown
 * files a Knowledge Category maps to. The standalone `knowledge-vault-mcp` process
 * remains the only component with `KNOWLEDGE_VAULT_*` write awareness; this adapter
 * never writes and ORC does not validate or require `KNOWLEDGE_VAULT_ROOT` to exist
 * (knowledge stays optional end to end, matching the MCP bridge behavior).
 */

export type VaultAvailability = "ok" | "knowledge_unavailable" | "retrieval_error";

/** Returns the configured vault root, or null when knowledge is not configured. */
function getVaultRoot(): string | null {
  const root = process.env.KNOWLEDGE_VAULT_ROOT;

  return typeof root === "string" && root.trim().length > 0 ? root : null;
}

/**
 * Resolves a category's vault-relative directory to an absolute path, rejecting
 * any result that would escape the configured vault root.
 */
function resolveCategoryDirectory(
  vaultRoot: string,
  vaultRootPath: string,
): string | null {
  const resolvedRoot = path.resolve(vaultRoot);
  const resolvedDirectory = path.resolve(resolvedRoot, vaultRootPath);
  const relative = path.relative(resolvedRoot, resolvedDirectory);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolvedDirectory;
}

/** Lists the Markdown files directly inside one Knowledge Category's vault directory. */
export async function listCategoryVaultFiles(
  vaultRootPath: string,
): Promise<{ status: VaultAvailability; files: KnowledgeCategoryFile[] }> {
  const vaultRoot = getVaultRoot();

  if (!vaultRoot) {
    return { status: "knowledge_unavailable", files: [] };
  }

  const directory = resolveCategoryDirectory(vaultRoot, vaultRootPath);

  if (!directory) {
    return { status: "retrieval_error", files: [] };
  }

  try {
    const entries = await readdir(directory, { withFileTypes: true });

    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => ({
        path: `${vaultRootPath}/${entry.name}`,
        name: entry.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { status: "ok", files };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "knowledge_unavailable", files: [] };
    }

    return { status: "retrieval_error", files: [] };
  }
}

/**
 * Reads one exact Markdown file that must live directly inside the category's vault
 * directory. Rejects any requested path outside that directory (including traversal
 * segments and nested subdirectories) before touching the filesystem.
 */
export async function readCategoryVaultFile(
  vaultRootPath: string,
  requestedPath: string,
): Promise<{
  status: VaultAvailability;
  file: { path: string; name: string; content: string } | null;
}> {
  const vaultRoot = getVaultRoot();

  if (!vaultRoot) {
    return { status: "knowledge_unavailable", file: null };
  }

  const categoryPrefix = `${vaultRootPath}/`;

  if (!requestedPath.startsWith(categoryPrefix)) {
    return { status: "retrieval_error", file: null };
  }

  const fileName = requestedPath.slice(categoryPrefix.length);

  if (
    fileName.length === 0 ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".."
  ) {
    return { status: "retrieval_error", file: null };
  }

  const directory = resolveCategoryDirectory(vaultRoot, vaultRootPath);

  if (!directory) {
    return { status: "retrieval_error", file: null };
  }

  const resolvedFile = path.resolve(directory, fileName);

  if (path.dirname(resolvedFile) !== directory) {
    return { status: "retrieval_error", file: null };
  }

  try {
    const content = await readFile(resolvedFile, "utf8");

    return {
      status: "ok",
      file: { path: requestedPath, name: fileName, content },
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "knowledge_unavailable", file: null };
    }

    return { status: "retrieval_error", file: null };
  }
}

/** Detects the standard Node error for a missing file/directory. */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
