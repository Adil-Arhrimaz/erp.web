import { notFound, redirect } from "next/navigation";

import { CountDetail } from "@/components/stock/counts-view";
import { hasRole } from "@/lib/navigation";
import type { CountResult } from "@/lib/stock/types";
import { ErpError, erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function CountPage({ params }: PageProps<"/stock-count/[name]">) {
  const { name } = await params;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  const count = await erpCall<CountResult>(sid, "parapilot.api.stock.get_count", { name: decodeURIComponent(name) }).catch((e) => {
    if (e instanceof ErpError && e.status === 404) return null;
    throw e;
  });
  if (!count) notFound();
  return <CountDetail key={count.name} initial={count} />;
}
