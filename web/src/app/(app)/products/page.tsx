import { redirect } from "next/navigation";

import { ProductsView } from "@/components/products/products-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function ProductsPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant", "stock_clerk")) redirect("/");
  return <ProductsView canCreate={hasRole(context.roles, "owner", "manager")} />;
}
