"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useSession } from "@/components/session-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { findNavItem, navigationFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const PRIMARY_COUNT = 4;

/** Phone navigation: four phone-friendly screens at the bottom, everything in the "More" sheet. */
export function MobileNav() {
  const t = useTranslations("nav");
  const session = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = navigationFor(session.roles);
  const items = groups.flatMap((g) => g.items);
  // Phone-first screens fill the bar; counter screens (POS, till) are for tablets and desktops.
  const primary = [...items.filter((i) => i.phone), ...items.filter((i) => !i.phone)].slice(0, PRIMARY_COUNT);
  const active = findNavItem(pathname)?.key;

  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";

  return (
    <nav
      aria-label={t("openMenu")}
      className="bg-background/95 supports-backdrop-filter:bg-background/80 fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {primary.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(tab, active === item.key ? "text-primary" : "text-muted-foreground")}
        >
          <item.icon className="size-5" />
          <span className="max-w-full truncate px-1">{t(item.key)}</span>
        </Link>
      ))}
      {items.length > PRIMARY_COUNT && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger className={cn(tab, "text-muted-foreground")}>
            <Ellipsis className="size-5" />
            <span>{t("more")}</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{t("more")}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6">
              {groups.map((group) => (
                <div key={group.key ?? "main"} className="grid gap-1">
                  {group.key && (
                    <p className="text-muted-foreground px-2 text-xs font-medium">{t(`groups.${group.key}`)}</p>
                  )}
                  {group.items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "hover:bg-accent flex min-h-11 items-center gap-3 rounded-md px-2 text-sm",
                        active === item.key && "bg-accent font-medium",
                      )}
                    >
                      <item.icon className="text-muted-foreground size-4" />
                      {t(item.key)}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  );
}
