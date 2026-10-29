import { redirect } from "next/navigation";

import { TillView } from "@/components/pos/till-view";
import { hasRole } from "@/lib/navigation";
import type { TillStatus } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function TillPage() {
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "cashier")) redirect("/");
  const status = await erpCall<TillStatus>(sid, "parapilot.api.pos.get_till_status");
  return <TillView initialStatus={status} />;
}
