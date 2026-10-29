import { NextResponse } from "next/server";
import { z } from "zod";

import { erpCall } from "@/server/erpnext";
import { LOCALE_COOKIE, withSession } from "@/server/session";

const schema = z.object({
  language: z.enum(["fr", "en"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

/** Language and theme are saved to the ERPNext user, so a shared till follows whoever logs in. */
export const POST = withSession(async (sid, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Invalid request." } }, { status: 400 });
  }
  await erpCall(sid, "parapilot.api.session.set_preferences", parsed.data, "POST");
  const res = NextResponse.json({ ok: true });
  if (parsed.data.language) {
    res.cookies.set(LOCALE_COOKIE, parsed.data.language, { sameSite: "lax", path: "/" });
  }
  return res;
});
