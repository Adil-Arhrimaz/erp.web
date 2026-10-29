import { NextResponse } from "next/server";

import type { TillStatus } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(async (sid) =>
  NextResponse.json(await erpCall<TillStatus>(sid, "parapilot.api.pos.get_till_status")),
);
