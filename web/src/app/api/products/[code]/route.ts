import { NextResponse } from "next/server";

import type { ProductDetail } from "@/lib/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(
  async (sid, _request, { params }: { params: Promise<{ code: string }> }) => {
    const { code } = await params;
    return NextResponse.json(
      await erpCall<ProductDetail>(sid, "parapilot.api.catalog.get_product", { item_code: code }),
    );
  },
);
