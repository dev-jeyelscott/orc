"use client"

import { FolderIcon, GitBranchIcon } from "lucide-react"

import type { Project } from "@orc/shared"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const gitStateVariant = {
  clean: "success",
  dirty: "warning",
  unknown: "neutral",
} as const

interface ProjectViewProps {
  projects: Project[]
  workspaceRoot: string
}

interface ProjectPrimaryFilesProps {
  files: string[]
  limit?: number
}

/**
 * Compacts common home-directory prefixes for display without changing the received path value.
 */
function compactHomePath(value: string): string {
  const normalized = value.replace(/\\/g, "/")

  if (normalized === "/root") {
    return "~"
  }

  if (normalized.startsWith("/root/")) {
    return `~${normalized.slice("/root".length)}`
  }

  const homeMatch = normalized.match(/^\/(?:home|Users)\/[^/]+(\/.*)?$/)

  if (homeMatch) {
    return `~${homeMatch[1] ?? ""}`
  }

  return value
}

/**
 * Produces a compact workspace-relative project path for display while preserving the absolute source value.
 */
function compactProjectPath(
  projectPath: string,
  workspaceRoot: string,
): string {
  const normalizedProjectPath = projectPath.replace(/\\/g, "/")
  const normalizedWorkspaceRoot = workspaceRoot
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")

  if (normalizedProjectPath === normalizedWorkspaceRoot) {
    return compactHomePath(normalizedWorkspaceRoot)
  }

  if (normalizedProjectPath.startsWith(`${normalizedWorkspaceRoot}/`)) {
    return `${compactHomePath(
      normalizedWorkspaceRoot,
    )}${normalizedProjectPath.slice(normalizedWorkspaceRoot.length)}`
  }

  return compactHomePath(normalizedProjectPath)
}

/**
 * Converts an undetected package manager into the shared unavailable-value presentation.
 */
function displayPackageManager(
  packageManager: Project["packageManager"],
): string {
  return packageManager === "unknown" ? "—" : packageManager
}

/**
 * Renders the existing semantic Git-state badge with textual and accessible meaning.
 */
function ProjectGitStateBadge({
  project,
}: {
  project: Project
}) {
  return (
    <Badge
      variant={gitStateVariant[project.gitState]}
      aria-label={`Git state: ${project.gitState}`}
    >
      {project.gitState}
    </Badge>
  )
}

/**
 * Renders compact primary-file chips and exposes overflow values through the existing tooltip primitive.
 */
function ProjectPrimaryFiles({
  files,
  limit = 2,
}: ProjectPrimaryFilesProps) {
  if (files.length === 0) {
    return <span className="text-text-muted">—</span>
  }

  const visibleFiles = files.slice(0, limit)
  const overflowFiles = files.slice(limit)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {visibleFiles.map((file) => (
        <span
          key={file}
          className="rounded-md border border-border-default bg-surface-interactive px-2 py-0.5 font-mono text-[11px] text-text-secondary"
          title={file}
        >
          {file}
        </span>
      ))}

      {overflowFiles.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="rounded-md border border-border-default bg-surface-interactive px-2 py-0.5 font-mono text-[11px] text-text-muted outline-none transition-colors hover:text-text-primary focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/40"
                aria-label={`Show ${overflowFiles.length} more primary files`}
              >
                +{overflowFiles.length}
              </button>
            }
          />
          <TooltipContent className="font-mono">
            {overflowFiles.join(", ")}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

/**
 * Renders the dense Details mode using every relevant field in the existing Project contract.
 */
function ProjectTable({
  projects,
  workspaceRoot,
}: ProjectViewProps) {
  return (
    <Table className="min-w-[1180px]">
      <TableHeader className="bg-surface-interactive/50">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Name
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Path
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Branch
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Git state
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Stack
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Package manager
          </TableHead>
          <TableHead className="h-9 px-4 text-xs text-text-secondary">
            Primary files
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {projects.map((project) => (
          <TableRow
            key={project.id}
            className="h-14 border-divider hover:bg-surface-interactive/50"
          >
            <TableCell className="px-4 py-2">
              <div className="flex min-w-52 items-center gap-3">
                <FolderIcon
                  className="size-4 shrink-0 text-brand-accent"
                  aria-hidden="true"
                />
                <span className="font-medium text-text-primary">
                  {project.name}
                </span>
              </div>
            </TableCell>

            <TableCell
              className="max-w-[360px] px-4 py-2 font-mono text-xs text-text-muted"
              title={project.path}
            >
              <span className="block truncate">
                {compactProjectPath(
                  project.path,
                  workspaceRoot,
                )}
              </span>
            </TableCell>

            <TableCell className="px-4 py-2 font-mono text-xs text-text-secondary">
              {project.branch ?? "—"}
            </TableCell>

            <TableCell className="px-4 py-2">
              <ProjectGitStateBadge project={project} />
            </TableCell>

            <TableCell className="px-4 py-2 text-xs text-text-muted">
              {project.stack ?? "—"}
            </TableCell>

            <TableCell className="px-4 py-2 font-mono text-xs text-text-muted">
              {displayPackageManager(project.packageManager)}
            </TableCell>

            <TableCell className="px-4 py-2">
              <ProjectPrimaryFiles
                files={project.primaryFiles}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Renders List mode as compact directory-manager rows with concise repository metadata.
 */
function ProjectCompactList({
  projects,
  workspaceRoot,
}: ProjectViewProps) {
  return (
    <div
      role="list"
      className="divide-y divide-divider"
    >
      {projects.map((project) => (
        <article
          key={project.id}
          role="listitem"
          className="flex min-w-0 flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-interactive/50 lg:flex-row lg:items-center lg:gap-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <FolderIcon
              className="size-4 shrink-0 text-brand-accent"
              aria-hidden="true"
            />

            <div className="min-w-0">
              <p className="truncate font-medium text-text-primary">
                {project.name}
              </p>
              <p
                className="truncate font-mono text-xs text-text-muted"
                title={project.path}
              >
                {compactProjectPath(
                  project.path,
                  workspaceRoot,
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted lg:justify-end">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <GitBranchIcon
                className="size-3.5"
                aria-hidden="true"
              />
              {project.branch ?? "—"}
            </span>

            <ProjectGitStateBadge project={project} />

            <span>{project.stack ?? "—"}</span>

            <span className="font-mono">
              {displayPackageManager(
                project.packageManager,
              )}
            </span>
          </div>
        </article>
      ))}
    </div>
  )
}

/**
 * Renders Grid mode as responsive dense repository cards using the existing shared Card primitive.
 */
function ProjectGrid({
  projects,
  workspaceRoot,
}: ProjectViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {projects.map((project) => (
        <Card
          key={project.id}
          size="sm"
          className="gap-3 rounded-lg bg-surface-card shadow-none ring-1 ring-border-default transition-colors hover:bg-surface-interactive/40"
        >
          <CardHeader className="gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <FolderIcon
                  className="size-4 shrink-0 text-brand-accent"
                  aria-hidden="true"
                />
                <p className="truncate font-medium text-text-primary">
                  {project.name}
                </p>
              </div>

              <ProjectGitStateBadge project={project} />
            </div>

            <p
              className="truncate font-mono text-xs text-text-muted"
              title={project.path}
            >
              {compactProjectPath(
                project.path,
                workspaceRoot,
              )}
            </p>
          </CardHeader>

          <CardContent className="grid gap-2 text-xs">
            <div className="grid grid-cols-[88px_1fr] gap-2">
              <span className="text-text-muted">
                Branch
              </span>
              <span className="truncate font-mono text-text-secondary">
                {project.branch ?? "—"}
              </span>
            </div>

            <div className="grid grid-cols-[88px_1fr] gap-2">
              <span className="text-text-muted">
                Stack
              </span>
              <span className="truncate text-text-secondary">
                {project.stack ?? "—"}
              </span>
            </div>

            <div className="grid grid-cols-[88px_1fr] gap-2">
              <span className="text-text-muted">
                Package
              </span>
              <span className="truncate font-mono text-text-secondary">
                {displayPackageManager(
                  project.packageManager,
                )}
              </span>
            </div>

            <div className="grid gap-1.5 border-t border-divider pt-2">
              <span className="text-text-muted">
                Primary files
              </span>
              <ProjectPrimaryFiles
                files={project.primaryFiles}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export {
  ProjectCompactList,
  ProjectGrid,
  ProjectTable,
}
