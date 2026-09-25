import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  className?: string;
  rowClassName?: string;
  onRowClick?: (row: T) => void;
}

/**
 * Shared table shell reproducing the `Table > TableHeader(bg-surface-interactive/45) > TableBody`
 * markup duplicated across every "manager" page. Row hover state and header styling are baked in
 * once; per-cell rendering stays fully custom via `columns[].render` so page-specific complexity
 * (nested rows, chips, tree views) stays in column config rather than in the table shell.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  className,
  rowClassName,
  onRowClick,
}: DataTableProps<T>) {
  return (
    <Table className={className}>
      <TableHeader className="bg-surface-interactive/45">
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={getRowKey(row)}
            className={cn("border-divider hover:bg-surface-interactive/45", onRowClick && "cursor-pointer", rowClassName)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
