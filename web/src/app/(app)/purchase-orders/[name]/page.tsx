import { notFound, redirect } from "next/navigation";

import { OrderEditor } from "@/components/purchasing/orders-view";
import { hasRole } from "@/lib/navigation";
import type { PurchaseOrder } from "@/lib/purchasing/types";
import { ErpError, erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[name]">) {
  const { name } = await params;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  const order =
    name === "new"
      ? null
      : await erpCall<PurchaseOrder>(sid, "parapilot.api.purchasing.get_purchase_order", { name: decodeURIComponent(name) }).catch(
          (e) => {
            if (e instanceof ErpError && e.status === 404) return undefined;
            throw e;
          },
        );
  if (order === undefined) notFound();
  return <OrderEditor key={order?.name ?? "new"} order={order} canSubmitRole={hasRole(context.roles, "owner", "manager")} />;
}
