"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Status tabs on the left, the "new" action on the right; stacks on phones. */
export function PageToolbar<T extends string>({
  tabs,
  value,
  onChange,
  newHref,
  newLabel,
  children,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  newHref?: string;
  newLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        className="w-full flex-wrap justify-start lg:w-auto"
      >
        {tabs.map((tab) => (
          <ToggleGroupItem key={tab.value} value={tab.value} className="h-10 px-3">
            {tab.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {children}
      {newHref && (
        <Button asChild size="lg" className="h-11 lg:ms-auto">
          <Link href={newHref}>
            <Plus /> {newLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
