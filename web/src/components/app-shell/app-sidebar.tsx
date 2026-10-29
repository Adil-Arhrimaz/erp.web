"use client";

import { Leaf } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { useSession } from "@/components/session-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { findNavItem, navigationFor } from "@/lib/navigation";

import { SidebarUserMenu } from "./user-menu";

export function AppSidebar() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const session = useSession();
  const pathname = usePathname();
  const active = findNavItem(pathname)?.key;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
                  <Leaf className="size-4" />
                </span>
                <span className="grid flex-1 text-start leading-tight">
                  <span className="font-semibold">{tc("appName")}</span>
                  <span className="text-muted-foreground truncate text-xs">{session.company?.name}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navigationFor(session.roles).map((group) => (
          <SidebarGroup key={group.key ?? "main"}>
            {group.key && <SidebarGroupLabel>{t(`groups.${group.key}`)}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active === item.key} tooltip={t(item.key)}>
                      <Link href={item.href} className={item.ready ? undefined : "opacity-60"}>
                        <item.icon />
                        <span>{t(item.key)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarUserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
