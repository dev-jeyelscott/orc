"use client"

import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface FileRow {
  name: string
  size: string
  updated: string
  status?: string
}

interface FileTableProps {
  files: FileRow[]
  onDownload?: (file: FileRow) => void
  className?: string
}

function FileTable({ files, onDownload, className }: FileTableProps) {
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-end">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow key={file.name}>
            <TableCell className="font-mono text-xs text-text-primary">
              {file.name}
            </TableCell>
            <TableCell className="text-xs text-text-muted">{file.size}</TableCell>
            <TableCell className="text-xs text-text-muted">{file.updated}</TableCell>
            <TableCell className="text-end">
              <div className="flex items-center justify-end gap-2">
                {file.status ? (
                  <span className="font-mono text-xs text-text-muted">
                    {file.status}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDownload?.(file)}
                  aria-label={`Download ${file.name}`}
                >
                  <DownloadIcon />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { FileTable }
export type { FileRow }
