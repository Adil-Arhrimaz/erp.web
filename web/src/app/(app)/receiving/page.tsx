import { redirect } from "next/navigation";

import { ReceivingList } from "@/components/purchasing/receiving-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function ReceivingPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  return <ReceivingList canReceive />;
}
