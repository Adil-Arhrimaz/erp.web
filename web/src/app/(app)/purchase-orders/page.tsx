import { redirect } from "next/navigation";

import { OrdersView } from "@/components/purchasing/orders-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function PurchaseOrdersPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  return <OrdersView canCreate />;
}
