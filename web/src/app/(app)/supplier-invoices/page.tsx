import { redirect } from "next/navigation";

import { InvoicesView } from "@/components/purchasing/invoices-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function SupplierInvoicesPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  return <InvoicesView canCreate />;
}
