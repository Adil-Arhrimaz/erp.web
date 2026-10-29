import { redirect } from "next/navigation";

import { TransfersView, type TransferPrefill } from "@/components/stock/transfers-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function TransfersPage({ searchParams }: PageProps<"/transfers">) {
  const params = await searchParams;
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  const prefill = {
    mode: one(params.mode),
    reason: one(params.reason),
    item: one(params.item),
    batch: one(params.batch),
    qty: one(params.qty),
    from: one(params.from),
  } as TransferPrefill;
  return <TransfersView prefill={prefill} />;
}
