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

interface PackageManifest {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  packageManager?: string;
}

interface ComposerManifest {
  require?: Record<string, unknown>;
  requireDev?: Record<string, unknown>;
}

/**
 * Checks whether a filesystem path exists without propagating filesystem errors.
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives a stable runtime project identifier from its absolute filesystem path.
 */
function deriveProjectId(absolutePath: string): string {
  return crypto
    .createHash("sha256")
    .update(absolutePath)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Reads the current Git branch and clean/dirty state while degrading Git failures to unknown.
 */
async function readGitState(
  dirPath: string,
): Promise<{
  branch: string | null;
  gitState: GitState;
}> {
  let branch: string | null = null;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dirPath, "branch", "--show-current"],
      {
        timeout: GIT_COMMAND_TIMEOUT_MS,
      },
    );

    const trimmed = stdout.trim();
    branch =
      trimmed.length > 0
        ? trimmed
        : "(detached)";
  } catch {
    return {
      branch: null,
      gitState: "unknown",
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dirPath, "status", "--porcelain"],
      {
        timeout: GIT_COMMAND_TIMEOUT_MS,
      },
    );

    return {
      branch,
      gitState:
        stdout.trim().length > 0
          ? "dirty"
          : "clean",
    };
  } catch {
    return {
      branch,
      gitState: "unknown",
    };
  }
}

/**
 * Detects supported root-level project marker files without scanning nested directories.
 */
async function detectMarkerFiles(
  dirPath: string,
): Promise<string[]> {
  const results = await Promise.all(
    MARKER_FILES.map(
      async (
        file,
      ): Promise<string | null> =>
        (await pathExists(
          path.join(dirPath, file),
        ))
          ? file
          : null,
    ),
  );

  return results.filter(
    (file): file is string =>
      file !== null,
  );
}

/**
 * Normalizes an unknown dependency section into a safe string-keyed record.
 */
function normalizeDependencyMap(
  value: unknown,
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  return value as Record<
    string,
    unknown
  >;
}

/**
 * Reads only the lightweight package.json metadata required for stack and package-manager detection.
 */
async function readPackageManifest(
  dirPath: string,
): Promise<PackageManifest | null> {
  try {
    const raw = await fs.readFile(
      path.join(
        dirPath,
        "package.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(
      raw,
    ) as unknown;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const manifest =
      parsed as Record<
        string,
        unknown
      >;

    return {
      dependencies:
        normalizeDependencyMap(
          manifest.dependencies,
        ),
      devDependencies:
        normalizeDependencyMap(
          manifest.devDependencies,
        ),
      packageManager:
        typeof manifest.packageManager ===
        "string"
          ? manifest.packageManager
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Reads only Composer dependency metadata needed to identify obvious PHP frameworks.
 */
async function readComposerManifest(
  dirPath: string,
): Promise<ComposerManifest | null> {
  try {
    const raw = await fs.readFile(
      path.join(
        dirPath,
        "composer.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(
      raw,
    ) as unknown;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const manifest =
      parsed as Record<
        string,
        unknown
      >;

    return {
      require:
        normalizeDependencyMap(
          manifest.require,
        ),
      requireDev:
        normalizeDependencyMap(
          manifest["require-dev"],
        ),
    };
  } catch {
    return null;
  }
}

/**
 * Checks whether package.json declares a dependency in dependencies or devDependencies.
 */
function hasPackageDependency(
  manifest: PackageManifest | null,
  dependency: string,
): boolean {
  const sections = [
    manifest?.dependencies,
    manifest?.devDependencies,
  ];

  return sections.some(
    (section) =>
      section !== undefined &&
      Object.prototype.hasOwnProperty.call(
        section,
        dependency,
      ),
  );
}

/**
 * Checks whether composer.json declares a dependency in require or require-dev.
 */
function hasComposerDependency(
  manifest: ComposerManifest | null,
  dependency: string,
): boolean {
  const sections = [
    manifest?.require,
    manifest?.requireDev,
  ];

  return sections.some(
    (section) =>
      section !== undefined &&
      Object.prototype.hasOwnProperty.call(
        section,
        dependency,
      ),
  );
}

/**
 * Derives the package manager only from explicit evidence such as lockfiles or manifest metadata.
 */
function derivePackageManager(
  files: string[],
  packageManifest: PackageManifest | null,
  composerManifest: ComposerManifest | null,
): PackageManager {
  if (
    files.includes(
      "composer.json",
    ) &&
    hasComposerDependency(
      composerManifest,
      "laravel/framework",
    )
  ) {
    return "composer";
  }

  if (
    files.includes(
      "pnpm-lock.yaml",
    )
  ) {
    return "pnpm";
  }

  if (
    files.includes("yarn.lock")
  ) {
    return "yarn";
  }

  if (
    files.includes(
      "package-lock.json",
    )
  ) {
    return "npm";
  }

  if (
    packageManifest?.packageManager
  ) {
    const [manager] =
      packageManifest.packageManager.split(
        "@",
        1,
      );

    if (
      manager === "pnpm" ||
      manager === "yarn" ||
      manager === "npm"
    ) {
      return manager;
    }
  }

  if (
    files.includes(
      "composer.json",
    )
  ) {
    return "composer";
  }

  if (
    files.includes(
      "requirements.txt",
    )
  ) {
    return "pip";
  }

  if (
    files.includes("go.mod")
  ) {
    return "go";
  }

  if (
    files.includes(
      "Cargo.toml",
    )
  ) {
    return "cargo";
  }

  return "unknown";
}

/**
 * Derives the primary stack or obvious framework using marker files and lightweight manifest metadata.
 */
function deriveStack(
  files: string[],
  packageManifest: PackageManifest | null,
  composerManifest: ComposerManifest | null,
): string | null {
  if (
    files.includes(
      "composer.json",
    ) &&
    hasComposerDependency(
      composerManifest,
      "laravel/framework",
    )
  ) {
    return "laravel";
  }

  if (
    files.includes(
      "package.json",
    )
  ) {
    if (
      hasPackageDependency(
        packageManifest,
        "next",
      )
    ) {
      return "nextjs";
    }

    if (
      hasPackageDependency(
        packageManifest,
        "react",
      )
    ) {
      return "react";
    }

    return "node";
  }

  if (
    files.includes(
      "composer.json",
    )
  ) {
    return "php";
  }

  if (
    files.includes(
      "pyproject.toml",
    ) ||
    files.includes(
      "requirements.txt",
    )
  ) {
    return "python";
  }

  if (
    files.includes("go.mod")
  ) {
    return "go";
  }

  if (
    files.includes(
      "Cargo.toml",
    )
  ) {
    return "rust";
  }

  return null;
}

/**
 * Builds the complete lightweight metadata response for one discovered repository.
 */
async function buildProjectMetadata(
  dirPath: string,
): Promise<Project> {
  const [
    {
      branch,
      gitState,
    },
    primaryFiles,
  ] = await Promise.all([
    readGitState(dirPath),
    detectMarkerFiles(dirPath),
  ]);

  const [
    packageManifest,
    composerManifest,
  ] = await Promise.all([
    primaryFiles.includes(
      "package.json",
    )
      ? readPackageManifest(
          dirPath,
        )
      : Promise.resolve(
          null,
        ),
    primaryFiles.includes(
      "composer.json",
    )
      ? readComposerManifest(
          dirPath,
        )
      : Promise.resolve(
          null,
        ),
  ]);

  return {
    id: deriveProjectId(
      dirPath,
    ),
    name: path.basename(
      dirPath,
    ),
    path: dirPath,
    branch,
    gitState,
    primaryFiles,
    packageManager:
      derivePackageManager(
        primaryFiles,
        packageManifest,
        composerManifest,
      ),
    stack: deriveStack(
      primaryFiles,
      packageManifest,
      composerManifest,
    ),
  };
}

/**
 * Discovers only real direct-child directories containing .git beneath the configured workspace root.
 */
export async function listProjects(
  workspaceRoot: string,
): Promise<ProjectListResponse> {
  let stat;

  try {
    stat = await fs.stat(
      workspaceRoot,
    );
  } catch {
    return {
      projects: [],
      workspaceRoot,
      error:
        `Workspace root not found: ${workspaceRoot}`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      projects: [],
      workspaceRoot,
      error:
        `Workspace root is not a directory: ${workspaceRoot}`,
    };
  }

  const entries =
    await fs.readdir(
      workspaceRoot,
      {
        withFileTypes: true,
      },
    );

  const candidateDirs =
    entries
      .filter(
        (entry) =>
          entry.isDirectory(),
      )
      .map((entry) =>
        path.resolve(
          workspaceRoot,
          entry.name,
        ),
      );

  const projectDirs: string[] =
    [];

  for (
    const dirPath of candidateDirs
  ) {
    if (
      await pathExists(
        path.join(
          dirPath,
          ".git",
        ),
      )
    ) {
      projectDirs.push(
        dirPath,
      );
    }
  }

  const projects =
    await Promise.all(
      projectDirs.map(
        (dirPath) =>
          buildProjectMetadata(
            dirPath,
          ),
      ),
    );

  projects.sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
      ),
  );

  return {
    projects,
    workspaceRoot,
    error: null,
  };
}

/**
 * Resolves a project identifier against the current filesystem discovery result.
 */
export async function getProject(
  workspaceRoot: string,
  projectId: string,
): Promise<Project | null> {
  const { projects } =
    await listProjects(
      workspaceRoot,
    );

  return (
    projects.find(
      (project) =>
        project.id ===
        projectId,
    ) ?? null
  );
}

/**
 * Resolves an absolute project path against the current filesystem-backed project registry.
 */
export async function getProjectByPath(
  workspaceRoot: string,
  projectPath: string,
): Promise<Project | null> {
  const canonicalPath =
    path.resolve(
      projectPath,
    );

  const { projects } =
    await listProjects(
      workspaceRoot,
    );

  return (
    projects.find(
      (project) =>
        path.resolve(
          project.path,
        ) ===
        canonicalPath,
    ) ?? null
  );
}
