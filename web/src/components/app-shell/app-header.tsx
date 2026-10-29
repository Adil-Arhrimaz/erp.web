"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { findNavItem } from "@/lib/navigation";

import { CommandMenu } from "./command-menu";
import { UserAvatar, UserMenuContent } from "./user-menu";

export function AppHeader() {
  const t = useTranslations("nav");
  const item = findNavItem(usePathname());

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <SidebarTrigger className="-ms-1 hidden md:inline-flex" aria-label={t("openMenu")} />
      <Separator orientation="vertical" className="me-1 hidden h-4 md:block" />
      <h1 className="truncate text-base font-semibold">{item ? t(item.key) : null}</h1>
      <div className="ms-auto flex items-center gap-2">
        <CommandMenu />
        {/* On phones the sidebar is hidden: the user menu lives in the header. */}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full md:hidden" aria-label={t("userMenu")}>
            <UserAvatar className="size-9" />
          </DropdownMenuTrigger>
          <UserMenuContent side="bottom" />
        </DropdownMenu>
      </div>
    </header>
  );
}
