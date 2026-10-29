import { redirect } from "next/navigation";

import { VatView } from "@/components/vat/vat-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function VatPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  return <VatView />;
}
