import { redirect } from "next/navigation";

import { InvoiceEditor } from "@/components/purchasing/invoices-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function NewSupplierInvoicePage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  return <InvoiceEditor />;
}
