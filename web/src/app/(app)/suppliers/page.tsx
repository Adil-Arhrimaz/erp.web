import { redirect } from "next/navigation";

import { SuppliersView } from "@/components/purchasing/suppliers-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function SuppliersPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant")) redirect("/");
  return <SuppliersView canEdit={hasRole(context.roles, "owner", "manager")} />;
}
