import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { StatusBadgeVariant } from "@/lib/task-presentation";
import { cn } from "@/lib/utils";

export type { StatusBadgeVariant } from "@/lib/task-presentation";

interface StatusBadgeProps {
  /** Semantic variant, derived from `getLifecycleBadgeVariant`/`getResultBadgeVariant`, plus the existing `badgeVariants` superset for non-lifecycle status values (e.g. Git state). */
  variant: StatusBadgeVariant | "disabled" | "outline" | "secondary" | "default" | "destructive" | "ghost" | "link";
  /** Human-readable status text rendered inside the badge. */
  label: ReactNode;
  /** Entity label used to build the default `aria-label`, e.g. "Task", "Run", "Skill". */
  entityLabel?: string;
  /** Explicit aria-label override; defaults to `"${entityLabel} status: ${label}"` when `entityLabel` is provided. */
  "aria-label"?: string;
  /** Shows the leading status dot. Defaults to true. */
  dot?: boolean;
  className?: string;
}

/**
 * Shared status badge reproducing the union of every ad hoc lifecycle/status badge
 * (`RunStatusBadge`, `SkillStatusBadge`, `TeamStatusBadge`, `ProjectGitStateBadge`, and
 * inline `getLifecycleBadgeVariant` call sites) behind one component.
 */
export function StatusBadge({
  variant,
  label,
  entityLabel,
  dot = true,
  className,
  ...rest
}: StatusBadgeProps) {
  const ariaLabel =
    rest["aria-label"] ??
    (entityLabel && typeof label === "string" ? `${entityLabel} status: ${label}` : undefined);

  return (
    <Badge variant={variant} aria-label={ariaLabel} className={cn(className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {label}
    </Badge>
  );
}
