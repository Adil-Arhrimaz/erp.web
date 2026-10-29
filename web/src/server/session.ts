import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";

import type { SessionContext } from "@/lib/types";

import { ErpError, erpCall } from "./erpnext";

export const SID_COOKIE = "pp_sid";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export async function getSid(): Promise<string | undefined> {
  return (await cookies()).get(SID_COOKIE)?.value;
}

/** The logged-in person's context, fetched once per request. Null when the session is gone. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const sid = await getSid();
  if (!sid) return null;
  try {
    return await erpCall<SessionContext>(sid, "parapilot.api.session.get_context");
  } catch (error) {
    if (error instanceof ErpError && (error.isAuth || error.status === 403)) return null;
    throw error;
  }
});

export async function requireSession(): Promise<{ sid: string; context: SessionContext }> {
  const [sid, context] = await Promise.all([getSid(), getSessionContext()]);
  if (!sid || !context) redirect("/login");
  return { sid, context };
}

export function errorResponse(error: unknown) {
  if (error instanceof ErpError) {
    const status = error.isAuth ? 401 : error.status;
    return NextResponse.json({ error: { message: error.message, type: error.excType } }, { status });
  }
  console.error(error);
  return NextResponse.json({ error: { message: "Unexpected error." } }, { status: 500 });
}

/** Route handler wrapper: requires a session and turns ERPNext errors into JSON responses. */
export function withSession<Args extends unknown[]>(
  handler: (sid: string, request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args) => {
    const sid = await getSid();
    if (!sid) return NextResponse.json({ error: { message: "Not logged in." } }, { status: 401 });
    try {
      return await handler(sid, request, ...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
