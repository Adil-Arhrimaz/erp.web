import { redirect } from "next/navigation";

import { StockView } from "@/components/stock/stock-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const { tab } = await searchParams;
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk", "accountant")) redirect("/");
  return (
    <StockView
      canWriteOff={hasRole(context.roles, "owner", "manager", "stock_clerk")}
      initialTab={tab === "expiry" || tab === "low" ? tab : "stock"}
    />
  );
}
