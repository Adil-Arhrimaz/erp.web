import { NextResponse } from "next/server";

import { saleSchema } from "@/lib/pos/schemas";
import type { Receipt } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

/** Idempotent: the device's sale ID is unique in ERPNext, so retries return the first invoice. */
export const POST = withSession(async (sid, request) => {
  const parsed = saleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Invalid sale.", issues: parsed.error.issues } }, { status: 400 });
  }
  return NextResponse.json(
    await erpCall<Receipt>(sid, "parapilot.api.pos.submit_sale", { sale: parsed.data }, "POST"),
  );
});
