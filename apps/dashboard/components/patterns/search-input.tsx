import { SearchIcon, XIcon } from "lucide-react";
import type { ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared search input reproducing the `InputGroup > InputGroupAddon(SearchIcon) > InputGroupInput`
 * shape already used across most pages, including the leading icon missing from a couple of pages.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  ...rest
}: SearchInputProps) {
  return (
    <InputGroup className={cn("min-w-56 flex-1", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={rest["aria-label"]}
        disabled={disabled}
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Clear ${rest["aria-label"]}`}
            disabled={disabled}
            onClick={() => onChange("")}
          >
            <XIcon />
          </Button>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}
