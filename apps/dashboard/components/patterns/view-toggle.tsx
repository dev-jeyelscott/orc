import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";

export interface ViewToggleMode {
  value: string;
  label: string;
  icon: ReactNode;
}

interface ViewToggleProps {
  value: string;
  onChange: (value: string) => void;
  modes: ViewToggleMode[];
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared table/card view toggle reproducing the `ButtonGroup` of outline `Button`s used in
 * `projects-list.tsx` and `runs-list.tsx`. Supports any number of modes, not only two.
 */
export function ViewToggle({ value, onChange, modes, disabled, className, ...rest }: ViewToggleProps) {
  return (
    <ButtonGroup className={cn("w-full sm:w-auto", className)} aria-label={rest["aria-label"]}>
      {modes.map((mode) => {
        const active = value === mode.value;

        return (
          <Button
            key={mode.value}
            type="button"
            variant="outline"
            className={cn(
              "flex-1 sm:flex-none",
              active && "border-brand-accent/50 bg-brand-accent/10 text-brand-accent hover:bg-brand-accent/15",
            )}
            aria-pressed={active}
            onClick={() => onChange(mode.value)}
            disabled={disabled}
          >
            {mode.icon}
            {mode.label}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
