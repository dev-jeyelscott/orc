import type { ChangeEvent } from "react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export interface FilterSelectOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  options: FilterSelectOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared status/entity filter select wrapping `NativeSelect`/`NativeSelectOption`.
 *
 * Convention: pass `{ value: "all", label: "All ..." }` as the first option to represent
 * "no filter applied" — every existing filter in the dashboard already uses `"all"` as this
 * sentinel value, and callers should keep doing so rather than inventing a new convention.
 */
export function FilterSelect({
  options,
  value,
  onChange,
  disabled,
  className,
  ...rest
}: FilterSelectProps) {
  return (
    <NativeSelect
      className={cn("w-36", className)}
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={rest["aria-label"]}
    >
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
