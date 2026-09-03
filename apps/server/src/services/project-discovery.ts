import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  GitState,
  PackageManager,
  Project,
  ProjectListResponse,
} from "@orc/shared";

const execFileAsync = promisify(execFile);

const GIT_COMMAND_TIMEOUT_MS = 5000;

const MARKER_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
] as const;

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function deriveProjectId(absolutePath: string): string {
  return crypto.createHash("sha256").update(absolutePath).digest("hex").slice(0, 16);
}

async function readGitState(dirPath: string): Promise<{ branch: string | null; gitState: GitState }> {
  let branch: string | null = null;

  try {
    const { stdout } = await execFileAsync("git", ["-C", dirPath, "branch", "--show-current"], {
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    const trimmed = stdout.trim();
    branch = trimmed.length > 0 ? trimmed : "(detached)";
  } catch {
    return { branch: null, gitState: "unknown" };
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", dirPath, "status", "--porcelain"], {
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return { branch, gitState: stdout.trim().length > 0 ? "dirty" : "clean" };
  } catch {
    return { branch, gitState: "unknown" };
  }
}

async function detectMarkerFiles(dirPath: string): Promise<string[]> {
  const results = await Promise.all(
    MARKER_FILES.map(async (file): Promise<string | null> =>
      (await pathExists(path.join(dirPath, file))) ? file : null,
    ),
  );
  return results.filter((file): file is string => file !== null);
}

function derivePackageManager(files: string[]): PackageManager {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("composer.json")) return "composer";
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) return "pip";
  if (files.includes("go.mod")) return "go";
  if (files.includes("Cargo.toml")) return "cargo";
  return "unknown";
}

function deriveStack(files: string[]): string | null {
  if (files.includes("package.json")) return "node";
  if (files.includes("composer.json")) return "php";
  if (files.includes("pyproject.toml") || files.includes("requirements.txt")) return "python";
  if (files.includes("go.mod")) return "go";
  if (files.includes("Cargo.toml")) return "rust";
  return null;
}

async function buildProjectMetadata(dirPath: string): Promise<Project> {
  const [{ branch, gitState }, primaryFiles] = await Promise.all([
    readGitState(dirPath),
    detectMarkerFiles(dirPath),
  ]);

  return {
    id: deriveProjectId(dirPath),
    name: path.basename(dirPath),
    path: dirPath,
    branch,
    gitState,
    primaryFiles,
    packageManager: derivePackageManager(primaryFiles),
    stack: deriveStack(primaryFiles),
  };
}

export async function listProjects(workspaceRoot: string): Promise<ProjectListResponse> {
  let stat;
  try {
    stat = await fs.stat(workspaceRoot);
  } catch {
    return {
      projects: [],
      workspaceRoot,
      error: `Workspace root not found: ${workspaceRoot}`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      projects: [],
      workspaceRoot,
      error: `Workspace root is not a directory: ${workspaceRoot}`,
    };
  }

  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });

  const candidateDirs: string[] = [];
  for (const entry of entries) {
    const entryPath = path.resolve(workspaceRoot, entry.name);
    if (entry.isDirectory()) {
      candidateDirs.push(entryPath);
    } else if (entry.isSymbolicLink()) {
      try {
        const resolved = await fs.stat(entryPath);
        if (resolved.isDirectory()) candidateDirs.push(entryPath);
      } catch {
        // broken symlink, skip
      }
    }
  }

  const projectDirs: string[] = [];
  for (const dirPath of candidateDirs) {
    if (await pathExists(path.join(dirPath, ".git"))) {
      projectDirs.push(dirPath);
    }
  }

  const projects = await Promise.all(projectDirs.map((dirPath) => buildProjectMetadata(dirPath)));
  projects.sort((a, b) => a.name.localeCompare(b.name));

  return { projects, workspaceRoot, error: null };
}

export async function getProject(workspaceRoot: string, projectId: string): Promise<Project | null> {
  const { projects } = await listProjects(workspaceRoot);
  return projects.find((project) => project.id === projectId) ?? null;
}
