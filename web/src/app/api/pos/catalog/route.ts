import { NextResponse } from "next/server";

import type { PosCatalog } from "@/lib/pos/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(async (sid, request) => {
  const posProfile = new URL(request.url).searchParams.get("pos_profile");
  if (!posProfile) return NextResponse.json({ error: { message: "pos_profile is required." } }, { status: 400 });
  return NextResponse.json(
    await erpCall<PosCatalog>(sid, "parapilot.api.pos.get_catalog", { pos_profile: posProfile }),
  );
});
