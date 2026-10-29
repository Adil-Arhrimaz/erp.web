import { NextResponse } from "next/server";

import type { ClosingPreview } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(async (sid) =>
  NextResponse.json(await erpCall<ClosingPreview>(sid, "parapilot.api.pos.get_closing_preview")),
);
