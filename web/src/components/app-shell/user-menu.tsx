"use client";

import { ChevronsUpDown, KeyRound, Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

import { OPEN_PIN_EVENT } from "./pin-dialog";
import { api } from "@/lib/api-client";
import { hasRole } from "@/lib/navigation";
import type { Locale, ThemePreference } from "@/lib/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserAvatar({ className }: { className?: string }) {
  const session = useSession();
  return (
    <Avatar className={className}>
      {session.image && <AvatarImage src={session.image} alt="" />}
      <AvatarFallback className="bg-primary/15 text-primary text-xs font-medium">
        {initials(session.full_name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function UserMenuContent({ side = "right" }: { side?: "right" | "top" | "bottom" }) {
  const t = useTranslations("common");
  const tr = useTranslations("returns.pin");
  const session = useSession();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [, startTransition] = useTransition();

  const savePreference = (body: { language?: Locale; theme?: ThemePreference }) =>
    api("/api/me/preferences", { method: "POST", json: body }).catch((e: Error) => {
      toast.error(e.message);
    });

  const changeTheme = (value: string) => {
    setTheme(value);
    void savePreference({ theme: value as ThemePreference });
  };

  const changeLanguage = (value: string) => {
    void savePreference({ language: value as Locale }).then(() => startTransition(() => router.refresh()));
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // The offline copy of the till pages carries this person's name: drop it on a shared device.
    if ("caches" in window) await caches.delete("parapilot-pages-v1").catch(() => undefined);
    window.location.assign("/login");
  };

  return (
    <DropdownMenuContent side={side} align="end" className="min-w-60">
      <DropdownMenuLabel className="flex items-center gap-2 font-normal">
        <UserAvatar className="size-8" />
        <div className="grid min-w-0 text-start leading-tight">
          <span className="truncate font-medium">{session.full_name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {session.roles.map((r) => t(`roles.${r}`)).join(", ")}
          </span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-muted-foreground text-xs">{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> {t("theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> {t("theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> {t("theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Languages className="size-3.5" /> {t("language.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={changeLanguage}>
          <DropdownMenuRadioItem value="fr">{t("language.fr")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t("language.en")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {hasRole(session.roles, "owner", "manager") && (
        <DropdownMenuItem onSelect={() => window.setTimeout(() => window.dispatchEvent(new Event(OPEN_PIN_EVENT)), 0)}>
          <KeyRound /> {tr("menu")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={logout}>
        <LogOut /> {t("logout")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function SidebarUserMenu() {
  const session = useSession();
  const t = useTranslations("nav");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label={t("userMenu")}>
          <UserAvatar className="size-8" />
          <div className="grid flex-1 text-start text-sm leading-tight">
            <span className="truncate font-medium">{session.full_name}</span>
            <span className="text-muted-foreground truncate text-xs">{session.company?.name}</span>
          </div>
          <ChevronsUpDown className="ms-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <UserMenuContent />
    </DropdownMenu>
  );
}
