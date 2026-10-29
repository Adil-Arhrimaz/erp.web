import { redirect } from "next/navigation";

import { CountsView } from "@/components/stock/counts-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function StockCountPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  return <CountsView canCount />;
}
