import { NextResponse } from "next/server";
import { z } from "zod";

import type { ZReport } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

const schema = z.object({ counted: z.record(z.string(), z.number().nonnegative()) });

export const POST = withSession(async (sid, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: "Invalid request." } }, { status: 400 });
  return NextResponse.json(await erpCall<ZReport>(sid, "parapilot.api.pos.close_till", parsed.data, "POST"));
});
