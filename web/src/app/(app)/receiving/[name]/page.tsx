import { notFound, redirect } from "next/navigation";

import { ReceiptView } from "@/components/purchasing/receiving-view";
import { hasRole } from "@/lib/navigation";
import type { ReceiptDetail } from "@/lib/purchasing/types";
import { ErpError, erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function ReceiptPage({ params }: PageProps<"/receiving/[name]">) {
  const { name } = await params;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  const receipt = await erpCall<ReceiptDetail>(sid, "parapilot.api.purchasing.get_receipt", { name: decodeURIComponent(name) }).catch(
    (e) => {
      if (e instanceof ErpError && e.status === 404) return null;
      throw e;
    },
  );
  if (!receipt) notFound();
  return <ReceiptView key={receipt.name} initial={receipt} />;
}
