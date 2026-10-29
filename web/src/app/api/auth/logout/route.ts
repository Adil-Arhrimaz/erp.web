import { NextResponse } from "next/server";

import { erpRequest } from "@/server/erpnext";
import { SID_COOKIE, getSid } from "@/server/session";

export async function POST() {
  const sid = await getSid();
  if (sid) {
    // End the ERPNext session too; ignore failures, the cookie is removed either way.
    await erpRequest("/api/method/logout", sid, { method: "POST" }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SID_COOKIE);
  return res;
}
