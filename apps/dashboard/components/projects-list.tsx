"use client"

import { AlertTriangleIcon, InboxIcon, RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { ProjectListResponse } from "@orc/shared"

import { ProjectTable } from "@/components/project-table"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { getProjects } from "@/lib/projects"

type Status = "loading" | "loaded" | "error"

function ProjectsList() {
  const [status, setStatus] = useState<Status>("loading")
  const [data, setData] = useState<ProjectListResponse | null>(null)

  const load = useCallback(() => {
    let cancelled = false

    getProjects()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setStatus("loaded")
      })
      .catch(() => {
        if (cancelled) return
        setStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => load(), [load])

  const refresh = useCallback(() => {
    setStatus("loading")
    load()
  }, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={status === "loading"}
        >
          <RefreshCwIcon className={status === "loading" ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {status === "loading" && (
        <Empty className="border">
          <Spinner className="size-6" />
          <EmptyTitle>Loading projects…</EmptyTitle>
        </Empty>
      )}

      {status === "error" && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-status-error/10 text-status-error">
              <AlertTriangleIcon />
            </EmptyMedia>
            <EmptyTitle>Failed to load projects</EmptyTitle>
            <EmptyDescription>Could not reach the backend. Please try again.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="destructive" onClick={refresh}>
              Retry
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {status === "loaded" && data && data.projects.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>No projects found</EmptyTitle>
            <EmptyDescription>
              {data.error ?? `No Git repositories found under ${data.workspaceRoot}.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {status === "loaded" && data && data.projects.length > 0 && (
        <ProjectTable projects={data.projects} />
      )}
    </div>
  )
}

export { ProjectsList }
