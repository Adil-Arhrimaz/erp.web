import { redirect } from "next/navigation";

import { SettingsView } from "@/components/settings/settings-view";
import { hasRole } from "@/lib/navigation";
import { requireSession } from "@/server/session";

export default async function SettingsPage() {
  const { context } = await requireSession();
  if (!hasRole(context.roles, "owner", "accountant")) redirect("/");
  return <SettingsView />;
}
