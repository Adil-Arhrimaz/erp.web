import { notFound, redirect } from "next/navigation";

import { InvoiceDetail } from "@/components/purchasing/invoices-view";
import { hasRole } from "@/lib/navigation";
import type { Invoice } from "@/lib/purchasing/types";
import { ErpError, erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function SupplierInvoicePage({ params }: PageProps<"/supplier-invoices/[name]">) {
  const { name } = await params;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  const invoice = await erpCall<Invoice>(sid, "parapilot.api.purchasing.get_invoice", { name: decodeURIComponent(name) }).catch(
    (e) => {
      if (e instanceof ErpError && e.status === 404) return null;
      throw e;
    },
  );
  if (!invoice) notFound();
  return <InvoiceDetail key={invoice.name} initial={invoice} />;
}
