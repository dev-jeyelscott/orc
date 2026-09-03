import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Project } from "@orc/shared";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  getProject,
  listProjects,
} from "./project-discovery.js";

let tempRoot = "";
let workspaceRoot = "";

/**
 * Creates an isolated temporary workspace for each project-discovery test.
 */
function setupTemporaryWorkspace(): void {
  tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "orc-project-discovery-"),
  );
  workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
}

/**
 * Removes the isolated temporary workspace and all test repositories.
 */
function cleanupTemporaryWorkspace(): void {
  fs.rmSync(tempRoot, {
    recursive: true,
    force: true,
  });
}

/**
 * Writes a file inside a test repository, creating parent directories when necessary.
 */
function writeProjectFile(
  repositoryPath: string,
  relativePath: string,
  content: string,
): void {
  const filePath = path.join(repositoryPath, relativePath);

  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  fs.writeFileSync(filePath, content);
}

/**
 * Creates a real Git repository with an optional collection of project files.
 */
function createGitRepository(
  repositoryPath: string,
  files: Record<string, string> = {},
): void {
  fs.mkdirSync(repositoryPath, {
    recursive: true,
  });

  execFileSync(
    "git",
    [
      "init",
      "-q",
      "--initial-branch=main",
      repositoryPath,
    ],
  );

  for (const [relativePath, content] of Object.entries(files)) {
    writeProjectFile(repositoryPath, relativePath, content);
  }
}

/**
 * Returns a discovered project by name and fails the test when it is unexpectedly absent.
 */
function findProject(
  projects: Project[],
  name: string,
): Project {
  const project = projects.find(
    (candidate) => candidate.name === name,
  );

  if (!project) {
    throw new Error(`Expected project "${name}" to be discovered`);
  }

  return project;
}

beforeEach(setupTemporaryWorkspace);
afterEach(cleanupTemporaryWorkspace);

describe("project-discovery", () => {
  it("returns a clear empty response when the workspace root is missing", async () => {
    const missingRoot = path.join(tempRoot, "missing-workspace");

    const result = await listProjects(missingRoot);

    expect(result).toEqual({
      projects: [],
      workspaceRoot: missingRoot,
      error: `Workspace root not found: ${missingRoot}`,
    });
  });

  it("discovers added direct-child repositories and removes them after deletion", async () => {
    const repositoryPath = path.join(
      workspaceRoot,
      "direct-repository",
    );

    expect((await listProjects(workspaceRoot)).projects).toEqual([]);

    createGitRepository(repositoryPath);

    const afterAdd = await listProjects(workspaceRoot);

    expect(
      afterAdd.projects.map((project) => project.name),
    ).toEqual(["direct-repository"]);

    fs.rmSync(repositoryPath, {
      recursive: true,
      force: true,
    });

    const afterRemove = await listProjects(workspaceRoot);

    expect(afterRemove.projects).toEqual([]);
  });

  it("ignores non-Git directories and nested Git repositories", async () => {
    fs.mkdirSync(
      path.join(workspaceRoot, "non-git-directory"),
      {
        recursive: true,
      },
    );

    createGitRepository(
      path.join(
        workspaceRoot,
        "parent-directory",
        "nested-repository",
      ),
    );

    const result = await listProjects(workspaceRoot);

    expect(result.projects).toEqual([]);
  });

  it("does not follow direct-child directory symlinks", async () => {
    const externalRepository = path.join(
      tempRoot,
      "external-repository",
    );

    createGitRepository(externalRepository);

    fs.symlinkSync(
      externalRepository,
      path.join(workspaceRoot, "linked-repository"),
      "dir",
    );

    const result = await listProjects(workspaceRoot);

    expect(result.projects).toEqual([]);
  });

  it("keeps project identifiers stable and resolves them through getProject", async () => {
    const repositoryPath = path.join(
      workspaceRoot,
      "stable-repository",
    );

    createGitRepository(repositoryPath);

    const first = await listProjects(workspaceRoot);
    const second = await listProjects(workspaceRoot);

    expect(first.projects).toHaveLength(1);
    expect(second.projects).toHaveLength(1);
    expect(first.projects[0].id).toBe(second.projects[0].id);

    const resolved = await getProject(
      workspaceRoot,
      first.projects[0].id,
    );

    expect(resolved).toMatchObject({
      id: first.projects[0].id,
      name: "stable-repository",
      path: repositoryPath,
    });
  });

  it("keeps repositories visible when Git metadata commands fail", async () => {
    const repositoryPath = path.join(
      workspaceRoot,
      "invalid-git-repository",
    );

    fs.mkdirSync(
      path.join(repositoryPath, ".git"),
      {
        recursive: true,
      },
    );

    const result = await listProjects(workspaceRoot);

    expect(result.projects).toHaveLength(1);

    expect(result.projects[0]).toMatchObject({
      name: "invalid-git-repository",
      path: repositoryPath,
      branch: null,
      gitState: "unknown",
    });
  });

  it("reports the current branch and clean or dirty Git state", async () => {
    const cleanRepository = path.join(
      workspaceRoot,
      "clean-repository",
    );
    const dirtyRepository = path.join(
      workspaceRoot,
      "dirty-repository",
    );

    createGitRepository(cleanRepository);
    createGitRepository(dirtyRepository);

    writeProjectFile(
      dirtyRepository,
      "README.md",
      "untracked change\n",
    );

    const result = await listProjects(workspaceRoot);

    const clean = findProject(
      result.projects,
      "clean-repository",
    );
    const dirty = findProject(
      result.projects,
      "dirty-repository",
    );

    expect(clean.branch).toBe("main");
    expect(clean.gitState).toBe("clean");

    expect(dirty.branch).toBe("main");
    expect(dirty.gitState).toBe("dirty");
  });

  it("detects obvious JavaScript frameworks and package managers from lightweight evidence", async () => {
    createGitRepository(
      path.join(workspaceRoot, "next-project"),
      {
        "package.json": JSON.stringify(
          {
            dependencies: {
              next: "16.0.0",
              react: "19.0.0",
            },
          },
          null,
          2,
        ),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      },
    );

    createGitRepository(
      path.join(workspaceRoot, "react-project"),
      {
        "package.json": JSON.stringify(
          {
            devDependencies: {
              react: "19.0.0",
            },
            packageManager: "yarn@4.9.2",
          },
          null,
          2,
        ),
      },
    );

    createGitRepository(
      path.join(workspaceRoot, "node-project"),
      {
        "package.json": JSON.stringify(
          {
            scripts: {
              test: "echo test",
            },
          },
          null,
          2,
        ),
      },
    );

    const result = await listProjects(workspaceRoot);

    const nextProject = findProject(
      result.projects,
      "next-project",
    );
    const reactProject = findProject(
      result.projects,
      "react-project",
    );
    const nodeProject = findProject(
      result.projects,
      "node-project",
    );

    expect(nextProject).toMatchObject({
      stack: "nextjs",
      packageManager: "pnpm",
    });
    expect(nextProject.primaryFiles).toEqual([
      "package.json",
      "pnpm-lock.yaml",
    ]);

    expect(reactProject).toMatchObject({
      stack: "react",
      packageManager: "yarn",
    });

    expect(nodeProject).toMatchObject({
      stack: "node",
      packageManager: "unknown",
    });
  });

  it("does not infer pip from pyproject.toml alone", async () => {
    createGitRepository(
      path.join(workspaceRoot, "pyproject-only"),
      {
        "pyproject.toml": [
          "[project]",
          'name = "example-project"',
          'version = "0.1.0"',
          "",
        ].join("\n"),
      },
    );

    createGitRepository(
      path.join(workspaceRoot, "requirements-project"),
      {
        "requirements.txt": "fastapi==0.116.0\n",
      },
    );

    const result = await listProjects(workspaceRoot);

    const pyprojectOnly = findProject(
      result.projects,
      "pyproject-only",
    );
    const requirementsProject = findProject(
      result.projects,
      "requirements-project",
    );

    expect(pyprojectOnly).toMatchObject({
      stack: "python",
      packageManager: "unknown",
    });

    expect(requirementsProject).toMatchObject({
      stack: "python",
      packageManager: "pip",
    });
  });
});
