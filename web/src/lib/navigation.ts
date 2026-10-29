import {
  ArrowLeftRight,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FileText,
  House,
  Landmark,
  type LucideIcon,
  Package,
  PackageCheck,
  Settings,
  ShoppingCart,
  Timer,
  Truck,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";

import type { AppRole } from "./types";

export type NavKey =
  | "home"
  | "pos"
  | "till"
  | "returns"
  | "customers"
  | "products"
  | "receiving"
  | "stock"
  | "stockCount"
  | "transfers"
  | "suppliers"
  | "purchaseOrders"
  | "supplierInvoices"
  | "reports"
  | "vat"
  | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  roles: AppRole[];
  /** False while the screen belongs to a later milestone. */
  ready: boolean;
  /** Designed for phones (spec screen inventory); these fill the phone's bottom bar first. */
  phone?: boolean;
}

export interface NavGroup {
  key: "sell" | "stock" | "purchasing" | "steer" | null;
  items: NavItem[];
}

const ALL: AppRole[] = ["owner", "manager", "accountant", "stock_clerk", "cashier"];

// Who sees which screen follows the roles table in the spec (section 3).
export const NAVIGATION: NavGroup[] = [
  {
    key: null,
    items: [{ key: "home", href: "/", icon: House, roles: ALL, ready: true, phone: true }],
  },
  {
    key: "sell",
    items: [
      { key: "pos", href: "/pos", icon: ShoppingCart, roles: ["owner", "manager", "cashier"], ready: true },
      { key: "till", href: "/till", icon: Wallet, roles: ["owner", "manager", "cashier"], ready: true },
      { key: "returns", href: "/returns", icon: Undo2, roles: ["owner", "manager", "cashier", "stock_clerk"], ready: true },
      { key: "customers", href: "/customers", icon: Users, roles: ["owner", "manager"], ready: true },
    ],
  },
  {
    key: "stock",
    items: [
      {
        key: "products",
        href: "/products",
        icon: Package,
        roles: ["owner", "manager", "accountant", "stock_clerk"],
        ready: true,
        phone: true,
      },
      {
        key: "receiving",
        href: "/receiving",
        icon: PackageCheck,
        roles: ["owner", "manager", "stock_clerk"],
        ready: true,
        phone: true,
      },
      {
        key: "stock",
        href: "/stock",
        icon: Timer,
        roles: ["owner", "manager", "stock_clerk"],
        ready: true,
        phone: true,
      },
      {
        key: "stockCount",
        href: "/stock-count",
        icon: ClipboardCheck,
        roles: ["owner", "manager", "stock_clerk"],
        ready: true,
        phone: true,
      },
      {
        key: "transfers",
        href: "/transfers",
        icon: ArrowLeftRight,
        roles: ["owner", "manager", "stock_clerk"],
        ready: true,
        phone: true,
      },
    ],
  },
  {
    key: "purchasing",
    items: [
      { key: "suppliers", href: "/suppliers", icon: Truck, roles: ["owner", "manager", "accountant"], ready: true },
      {
        key: "purchaseOrders",
        href: "/purchase-orders",
        icon: ClipboardList,
        roles: ["owner", "manager", "stock_clerk"],
        ready: true,
      },
      {
        key: "supplierInvoices",
        href: "/supplier-invoices",
        icon: FileText,
        roles: ["owner", "manager", "accountant"],
        ready: true,
      },
    ],
  },
  {
    key: "steer",
    items: [
      {
        key: "reports",
        href: "/reports",
        icon: BarChart3,
        roles: ["owner", "manager", "accountant"],
        ready: true,
        phone: true,
      },
      { key: "vat", href: "/vat", icon: Landmark, roles: ["owner", "manager", "accountant"], ready: true },
      { key: "settings", href: "/settings", icon: Settings, roles: ["owner", "accountant"], ready: true },
    ],
  },
];

export function navigationFor(roles: AppRole[]): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.some((r) => roles.includes(r))),
  })).filter((group) => group.items.length > 0);
}

export function findNavItem(pathname: string): NavItem | undefined {
  const items = NAVIGATION.flatMap((g) => g.items);
  return (
    items.find((i) => i.href !== "/" && (pathname === i.href || pathname.startsWith(`${i.href}/`))) ??
    items.find((i) => i.href === pathname)
  );
}

export function hasRole(roles: AppRole[], ...allowed: AppRole[]) {
  return allowed.some((r) => roles.includes(r));
}
