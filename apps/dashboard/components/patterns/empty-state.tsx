import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface ListEmptyStateProps {
  /** "loading" shows a spinner, "error" shows the error icon/retry, "empty" shows the plain title/description shape. */
  variant: "loading" | "error" | "empty";
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra action rendered in place of the retry button, e.g. a "Create X" CTA for the true-empty case. */
  action?: ReactNode;
  className?: string;
}

/**
 * Shared loading/error/empty state, standardizing the
 * `Empty > EmptyHeader > EmptyMedia + EmptyTitle + EmptyDescription (+ optional retry Button)`
 * shape already used ad hoc across every "manager" page.
 */
export function ListEmptyState({
  variant,
  title,
  description,
  icon,
  onRetry,
  retryLabel = "Retry",
  action,
  className,
}: ListEmptyStateProps) {
  if (variant === "loading") {
    return (
      <Empty className={cn("min-h-80 rounded-none border-0", className)}>
        <Spinner className="size-6" />
        <EmptyTitle>{title}</EmptyTitle>
      </Empty>
    );
  }

  return (
    <Empty className={cn("min-h-80 rounded-none border-0", className)} role={variant === "error" ? "alert" : undefined}>
      <EmptyHeader>
        {icon || variant === "error" ? (
          <EmptyMedia variant="icon" className={variant === "error" ? "bg-status-error/10 text-status-error" : undefined}>
            {icon}
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? (
        <EmptyContent>{action}</EmptyContent>
      ) : onRetry ? (
        <EmptyContent>
          <Button type="button" variant={variant === "error" ? "destructive" : "outline"} size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
