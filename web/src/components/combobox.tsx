"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Lets the person add a value that is not in the list yet (created on save). */
  creatable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

export function Combobox({ id, value, onChange, options, placeholder, creatable, disabled, invalid }: ComboboxProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const trimmed = query.trim();
  const canCreate =
    creatable && trimmed && !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  const pick = (next: string | null) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="h-10 w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {selected?.label ?? value ?? placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem value="__none__" onSelect={() => pick(null)} className="text-muted-foreground">
                  {t("none")}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem key={option.value} value={option.label} onSelect={() => pick(option.value)}>
                  <Check className={cn(option.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                  {option.hint && <span className="text-muted-foreground ms-auto text-xs">{option.hint}</span>}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem value={`__create__${trimmed}`} onSelect={() => pick(trimmed)}>
                  <Plus />
                  {t("create", { value: trimmed })}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
