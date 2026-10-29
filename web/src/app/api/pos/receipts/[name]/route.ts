import { NextResponse } from "next/server";

import type { Receipt } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(
  async (sid, _request, { params }: { params: Promise<{ name: string }> }) => {
    const { name } = await params;
    return NextResponse.json(await erpCall<Receipt>(sid, "parapilot.api.pos.get_receipt", { name }));
  },
);
