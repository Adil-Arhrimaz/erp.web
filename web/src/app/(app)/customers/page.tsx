import { redirect } from "next/navigation";

import { CustomersView } from "@/components/customers/customers-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function CustomersPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager")) redirect("/");
  return <CustomersView />;
}
