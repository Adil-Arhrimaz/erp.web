import { redirect } from "next/navigation";

import { ReceiptEditor } from "@/components/purchasing/receiving-view";
import { hasRole } from "@/lib/navigation";
import type { ReceiptDraft } from "@/lib/purchasing/types";
import { erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function NewReceiptPage({ searchParams }: PageProps<"/receiving/new">) {
  const { po, correct } = await searchParams;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "stock_clerk")) redirect("/");
  if (typeof correct === "string" && !hasRole(context.roles, "owner", "manager")) redirect(`/receiving/${encodeURIComponent(correct)}`);
  const draft = await erpCall<ReceiptDraft>(sid, "parapilot.api.purchasing.get_receipt_draft", {
    purchase_order: typeof po === "string" ? po : undefined,
    correct: typeof correct === "string" ? correct : undefined,
  });
  return <ReceiptEditor draft={draft} />;
}
