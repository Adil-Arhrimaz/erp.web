"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { navigationFor } from "@/lib/navigation";

/** Ctrl+K anywhere: jump to any screen the person can open. */
export function CommandMenu() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hidden w-56 justify-start gap-2 font-normal md:flex"
      >
        <Search />
        <span className="flex-1 text-start">{tc("search")}</span>
        <Kbd>Ctrl K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title={tc("search")} description={tc("commandPlaceholder")}>
        <CommandInput placeholder={tc("commandPlaceholder")} />
        <CommandList>
          <CommandEmpty>{tc("noResults")}</CommandEmpty>
          {navigationFor(session.roles).map((group) => (
            <CommandGroup key={group.key ?? "main"} heading={group.key ? t(`groups.${group.key}`) : undefined}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.key}
                  value={t(item.key)}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                >
                  <item.icon />
                  {t(item.key)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
