import { redirect } from "next/navigation";

import { SetupWizard } from "@/components/settings/setup-wizard";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function SetupPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "accountant")) redirect("/");
  return <SetupWizard />;
}
