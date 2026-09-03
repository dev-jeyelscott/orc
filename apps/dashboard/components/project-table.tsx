"use client"

import type { Project } from "@orc/shared"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const gitStateVariant = {
  clean: "success",
  dirty: "warning",
  unknown: "neutral",
} as const

interface ProjectTableProps {
  projects: Project[]
  className?: string
}

function ProjectTable({ projects, className }: ProjectTableProps) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Path</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Git state</TableHead>
          <TableHead className="text-end">Stack</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-medium text-text-primary">{project.name}</TableCell>
            <TableCell className="font-mono text-xs text-text-muted">{project.path}</TableCell>
            <TableCell className="text-xs text-text-muted">{project.branch ?? "—"}</TableCell>
            <TableCell>
              <Badge variant={gitStateVariant[project.gitState]}>{project.gitState}</Badge>
            </TableCell>
            <TableCell className="text-end text-xs text-text-muted">
              {project.stack ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { ProjectTable }
