import { redirect } from "next/navigation";

import { ReturnsView } from "@/components/stock/returns-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function ReturnsPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "cashier", "stock_clerk")) redirect("/");
  return (
    <ReturnsView
      canCustomer={hasRole(context.roles, "owner", "manager", "cashier")}
      canSupplier={hasRole(context.roles, "owner", "manager", "stock_clerk")}
      receiptLanguage={context.settings.receipt_language}
    />
  );
}
