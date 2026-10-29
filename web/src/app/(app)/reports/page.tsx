import { redirect } from "next/navigation";

import { ReportsView } from "@/components/reports/reports-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function ReportsPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  return <ReportsView canSeeCosts={hasRole(context.roles, "owner", "manager", "accountant")} />;
}
