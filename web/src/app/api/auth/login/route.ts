import { NextResponse } from "next/server";
import { z } from "zod";

import { ErpError, erpCall, erpRequest } from "@/server/erpnext";
import { LOCALE_COOKIE, SID_COOKIE, errorResponse } from "@/server/session";
import type { SessionContext } from "@/lib/types";

const schema = z.union([
  z.object({ usr: z.string().min(1), pwd: z.string().min(1) }),
  // Second step when ERPNext two-factor authentication is on (owner and accountant).
  z.object({ otp: z.string().min(4), tmp_id: z.string().min(1) }),
]);

/** Secure cookies only over HTTPS (directly or behind a proxy); a phone on the shop Wi-Fi uses plain HTTP. */
function isHttps(request: Request) {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Invalid request." } }, { status: 400 });
  }

  const secure = isHttps(request);
  try {
    const { body, response } = await erpRequest("/api/method/login", undefined, {
      method: "POST",
      body: parsed.data,
    });

    if (body.verification) {
      return NextResponse.json({
        verification: body.verification,
        tmp_id: body.tmp_id,
      });
    }

    const sid = response.headers
      .getSetCookie()
      .map((c) => /^sid=([^;]+)/.exec(c)?.[1])
      .find((v) => v && v !== "Guest");
    if (!sid) throw new ErpError("Login failed.", 401);

    const context = await erpCall<SessionContext>(sid, "parapilot.api.session.get_context");
    const res = NextResponse.json({ ok: true, language: context.language, theme: context.theme });
    res.cookies.set(SID_COOKIE, sid, { httpOnly: true, secure, sameSite: "lax", path: "/" });
    res.cookies.set(LOCALE_COOKIE, context.language, { secure, sameSite: "lax", path: "/" });
    return res;
  } catch (error) {
    if (error instanceof ErpError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json(
        { error: { message: error.message, type: "AuthenticationError" } },
        { status: 401 },
      );
    }
    return errorResponse(error);
  }
}
