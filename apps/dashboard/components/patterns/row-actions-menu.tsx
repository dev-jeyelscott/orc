import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface RowActionsMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

interface RowActionsMenuProps {
  /** Used for the trigger button's `aria-label`, e.g. `Actions for ${row.name}`. */
  label: string;
  items: RowActionsMenuItem[];
}

/**
 * Shared row-actions trigger reproducing the
 * `DropdownMenu > DropdownMenuTrigger(Button variant="ghost" size="icon-sm" MoreHorizontalIcon) > DropdownMenuContent`
 * shape duplicated across every "manager" page's row actions.
 */
export function RowActionsMenu({ label, items }: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} variant={item.destructive ? "destructive" : "default"} onClick={item.onClick}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
