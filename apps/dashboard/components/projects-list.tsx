"use client"

import {
  AlertTriangleIcon,
  FolderIcon,
  InboxIcon,
  LayoutGridIcon,
  ListIcon,
  RefreshCwIcon,
  SearchIcon,
  TableIcon,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type {
  Project,
  ProjectListResponse,
} from "@orc/shared"

import {
  ProjectCompactList,
  ProjectGrid,
  ProjectTable,
} from "@/components/project-table"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { getProjects } from "@/lib/projects"
import { cn } from "@/lib/utils"

type Status = "loading" | "loaded" | "error"
type SortKey =
  | "name"
  | "gitState"
  | "branch"
  | "stack"
type ViewMode = "list" | "details" | "grid"

const projectCollator = new Intl.Collator(
  undefined,
  {
    numeric: true,
    sensitivity: "base",
  },
)

const gitStateSortOrder: Record<
  Project["gitState"],
  number
> = {
  clean: 0,
  dirty: 1,
  unknown: 2,
}

/**
 * Produces a useful user-facing message from an unknown project-loading failure.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred while loading projects."
}

/**
 * Compacts common home-directory prefixes for workspace display without mutating the API value.
 */
function compactWorkspaceRoot(value: string): string {
  const normalized = value.replace(/\\/g, "/")

  if (normalized === "/root") {
    return "~"
  }

  if (normalized.startsWith("/root/")) {
    return `~${normalized.slice("/root".length)}`
  }

  const homeMatch = normalized.match(
    /^\/(?:home|Users)\/[^/]+(\/.*)?$/,
  )

  if (homeMatch) {
    return `~${homeMatch[1] ?? ""}`
  }

  return value
}

/**
 * Returns the selected sortable project field while preserving null for unavailable metadata.
 */
function getProjectSortValue(
  project: Project,
  sortKey: SortKey,
): string | null {
  switch (sortKey) {
    case "gitState":
      return project.gitState

    case "branch":
      return project.branch

    case "stack":
      return project.stack

    case "name":
    default:
      return project.name
  }
}

/**
 * Compares projects deterministically by the selected field, then project name, then stable project id.
 */
function compareProjects(
  left: Project,
  right: Project,
  sortKey: SortKey,
): number {
  let primaryComparison = 0

  if (sortKey === "gitState") {
    primaryComparison =
      gitStateSortOrder[left.gitState] -
      gitStateSortOrder[right.gitState]
  } else {
    const leftValue = getProjectSortValue(
      left,
      sortKey,
    )
    const rightValue = getProjectSortValue(
      right,
      sortKey,
    )

    if (
      leftValue === null &&
      rightValue !== null
    ) {
      return 1
    }

    if (
      leftValue !== null &&
      rightValue === null
    ) {
      return -1
    }

    primaryComparison =
      projectCollator.compare(
        leftValue ?? "",
        rightValue ?? "",
      )
  }

  if (primaryComparison !== 0) {
    return primaryComparison
  }

  const nameComparison =
    projectCollator.compare(
      left.name,
      right.name,
    )

  if (nameComparison !== 0) {
    return nameComparison
  }

  return projectCollator.compare(
    left.id,
    right.id,
  )
}

/**
 * Matches the normalized search term against every searchable field exposed by the current Project contract.
 */
function matchesProjectQuery(
  project: Project,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true
  }

  const fields = [
    project.name,
    project.path,
    project.branch ?? "",
    project.gitState,
    project.stack ?? "",
    project.packageManager,
    ...project.primaryFiles,
  ]

  return fields.some((field) =>
    field
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

/**
 * Owns project API state, client-side search and sorting, refresh behavior, and all three browser views.
 */
function ProjectsList() {
  const mountedRef = useRef(false)
  const requestInFlightRef = useRef(false)

  const [status, setStatus] =
    useState<Status>("loading")
  const [data, setData] =
    useState<ProjectListResponse | null>(null)
  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(null)
  const [
    refreshError,
    setRefreshError,
  ] = useState<string | null>(null)
  const [
    isRefreshing,
    setIsRefreshing,
  ] = useState(false)
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] =
    useState<SortKey>("name")
  const [viewMode, setViewMode] =
    useState<ViewMode>("details")

  /**
   * Starts the initial project request and commits React state only from asynchronous callbacks.
   */
  useEffect(() => {
    let cancelled = false

    mountedRef.current = true
    requestInFlightRef.current = true

    void getProjects()
      .then((result) => {
        if (cancelled) {
          return
        }

        setData(result)
        setStatus("loaded")
        setErrorMessage(null)
        setRefreshError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setStatus("error")
        setErrorMessage(
          getErrorMessage(error),
        )
      })
      .finally(() => {
        if (!cancelled) {
          requestInFlightRef.current =
            false
        }
      })

    return () => {
      cancelled = true
      mountedRef.current = false
      requestInFlightRef.current = false
    }
  }, [])

  /**
   * Reloads filesystem-backed project data while preserving loaded data during refresh failures.
   */
  const refresh = useCallback(async () => {
    if (requestInFlightRef.current) {
      return
    }

    const hasLoadedData = data !== null

    requestInFlightRef.current = true
    setRefreshError(null)

    if (hasLoadedData) {
      setIsRefreshing(true)
    } else {
      setStatus("loading")
      setErrorMessage(null)
    }

    try {
      const result = await getProjects()

      if (!mountedRef.current) {
        return
      }

      setData(result)
      setStatus("loaded")
      setErrorMessage(null)
      setRefreshError(null)
    } catch (error) {
      if (!mountedRef.current) {
        return
      }

      const message =
        getErrorMessage(error)

      if (hasLoadedData) {
        setRefreshError(message)
      } else {
        setStatus("error")
        setErrorMessage(message)
      }
    } finally {
      requestInFlightRef.current = false

      if (
        mountedRef.current &&
        hasLoadedData
      ) {
        setIsRefreshing(false)
      }
    }
  }, [data])

  const normalizedQuery = query
    .trim()
    .toLowerCase()

  const visibleProjects = useMemo(() => {
    if (!data) {
      return []
    }

    return data.projects
      .filter((project) =>
        matchesProjectQuery(
          project,
          normalizedQuery,
        ),
      )
      .slice()
      .sort((left, right) =>
        compareProjects(
          left,
          right,
          sortKey,
        ),
      )
  }, [
    data,
    normalizedQuery,
    sortKey,
  ])

  const isBusy =
    status === "loading" ||
    isRefreshing

  const totalProjects =
    data?.projects.length ?? 0

  const controlsDisabled =
    !data || totalProjects === 0

  const workspaceLabel = data
    ? compactWorkspaceRoot(
        data.workspaceRoot,
      )
    : "Workspace"

  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-xs"
      aria-label="Projects browser"
    >
      <div className="grid gap-3 border-b border-divider p-3 xl:grid-cols-[auto_minmax(18rem,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div
            className="flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-border-default bg-surface-interactive px-2.5 font-mono text-xs text-link"
            title={data?.workspaceRoot}
            aria-label={
              data
                ? `Workspace root: ${data.workspaceRoot}`
                : "Workspace root unavailable"
            }
          >
            <FolderIcon
              className="size-4 shrink-0 text-brand-accent"
              aria-hidden="true"
            />
            <span className="truncate">
              {workspaceLabel}
            </span>
          </div>

          <span className="text-xs text-text-muted">
            <span aria-hidden="true">
              •
            </span>{" "}
            {status === "loading" &&
            !data
              ? "Loading repositories"
              : `${totalProjects} ${
                  totalProjects === 1
                    ? "repository"
                    : "repositories"
                }`}
          </span>
        </div>

        <InputGroup className="w-full min-w-0">
          <InputGroupAddon>
            <SearchIcon
              aria-hidden="true"
            />
          </InputGroupAddon>

          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Search projects, paths, branches, stacks..."
            aria-label="Search projects"
            disabled={controlsDisabled}
          />
        </InputGroup>

        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <NativeSelect
            size="default"
            className="w-full sm:w-32"
            value={sortKey}
            onChange={(event) =>
              setSortKey(
                event.target
                  .value as SortKey,
              )
            }
            aria-label="Sort projects"
            disabled={controlsDisabled}
          >
            <NativeSelectOption value="name">
              Name
            </NativeSelectOption>
            <NativeSelectOption value="gitState">
              Git state
            </NativeSelectOption>
            <NativeSelectOption value="branch">
              Branch
            </NativeSelectOption>
            <NativeSelectOption value="stack">
              Stack
            </NativeSelectOption>
          </NativeSelect>

          <Button
            type="button"
            variant="outline"
            onClick={refresh}
            disabled={isBusy}
            aria-label="Refresh projects from the filesystem"
          >
            <RefreshCwIcon
              className={cn(
                isBusy &&
                  "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden="true"
            />
            Refresh
          </Button>

          <ButtonGroup
            className="w-full sm:w-auto"
            aria-label="Project view mode"
          >
            <Button
              type="button"
              variant="outline"
              className={cn(
                "flex-1 sm:flex-none",
                viewMode === "list" &&
                  "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
              )}
              aria-pressed={
                viewMode === "list"
              }
              onClick={() =>
                setViewMode("list")
              }
              disabled={controlsDisabled}
            >
              <ListIcon
                aria-hidden="true"
              />
              List
            </Button>

            <Button
              type="button"
              variant="outline"
              className={cn(
                "flex-1 sm:flex-none",
                viewMode === "details" &&
                  "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
              )}
              aria-pressed={
                viewMode === "details"
              }
              onClick={() =>
                setViewMode("details")
              }
              disabled={controlsDisabled}
            >
              <TableIcon
                aria-hidden="true"
              />
              Details
            </Button>

            <Button
              type="button"
              variant="outline"
              className={cn(
                "flex-1 sm:flex-none",
                viewMode === "grid" &&
                  "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
              )}
              aria-pressed={
                viewMode === "grid"
              }
              onClick={() =>
                setViewMode("grid")
              }
              disabled={controlsDisabled}
            >
              <LayoutGridIcon
                aria-hidden="true"
              />
              Grid
            </Button>
          </ButtonGroup>
        </div>
      </div>

      {refreshError && data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-divider bg-status-error/5 px-4 py-2 text-xs text-status-error"
        >
          <span>
            Failed to refresh projects.{" "}
            {refreshError}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={refresh}
            disabled={isRefreshing}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {data?.error &&
      data.projects.length > 0 ? (
        <div
          role="alert"
          className="border-b border-divider bg-status-warning/5 px-4 py-2 text-xs text-status-warning"
        >
          {data.error}
        </div>
      ) : null}

      <div className="min-w-0">
        {status === "loading" &&
        !data ? (
          <Empty className="min-h-80 rounded-none border-0">
            <Spinner className="size-6" />
            <EmptyTitle>
              Loading projects...
            </EmptyTitle>
          </Empty>
        ) : null}

        {status === "error" &&
        !data ? (
          <Empty className="min-h-80 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="bg-status-error/10 text-status-error"
              >
                <AlertTriangleIcon />
              </EmptyMedia>

              <EmptyTitle>
                Failed to load projects
              </EmptyTitle>

              <EmptyDescription>
                {errorMessage ??
                  "Could not reach the backend. Please try again."}
              </EmptyDescription>
            </EmptyHeader>

            <EmptyContent>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={refresh}
              >
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {data &&
        data.projects.length === 0 ? (
          <Empty className="min-h-80 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>

              <EmptyTitle>
                No projects found
              </EmptyTitle>

              <EmptyDescription>
                {data.error ??
                  `No direct-child Git repositories found under ${data.workspaceRoot}.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {data &&
        data.projects.length > 0 &&
        visibleProjects.length === 0 ? (
          <Empty className="min-h-64 rounded-none border-0">
            <EmptyHeader>
              <EmptyTitle>
                No matching projects
              </EmptyTitle>

              <EmptyDescription>
                No loaded repository matches
                the current search.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {data &&
        visibleProjects.length > 0 ? (
          <>
            {viewMode === "list" ? (
              <ProjectCompactList
                projects={
                  visibleProjects
                }
                workspaceRoot={
                  data.workspaceRoot
                }
              />
            ) : null}

            {viewMode === "details" ? (
              <ProjectTable
                projects={
                  visibleProjects
                }
                workspaceRoot={
                  data.workspaceRoot
                }
              />
            ) : null}

            {viewMode === "grid" ? (
              <ProjectGrid
                projects={
                  visibleProjects
                }
                workspaceRoot={
                  data.workspaceRoot
                }
              />
            ) : null}
          </>
        ) : null}
      </div>

      {data ? (
        <footer className="flex flex-col gap-2 border-t border-divider bg-surface-interactive/30 px-4 py-2.5 text-xs text-text-muted sm:flex-row sm:items-center">
          <span
            className="inline-flex items-center gap-2"
            aria-live="polite"
          >
            <FolderIcon
              className="size-3.5"
              aria-hidden="true"
            />
            {visibleProjects.length} of{" "}
            {totalProjects}{" "}
            {totalProjects === 1
              ? "project"
              : "projects"}
          </span>

          <span
            className="hidden text-divider sm:inline"
            aria-hidden="true"
          >
            |
          </span>

          <span
            className="inline-flex min-w-0 items-center gap-2 font-mono"
            title={data.workspaceRoot}
          >
            <FolderIcon
              className="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">
              {compactWorkspaceRoot(
                data.workspaceRoot,
              )}
            </span>
          </span>
        </footer>
      ) : null}
    </section>
  )
}

export { ProjectsList }
