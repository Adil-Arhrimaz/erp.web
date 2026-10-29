import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

/** Sends anyone without a session to the login screen; ERPNext checks the session itself. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p) || request.cookies.has("pp_sid")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { message: "Not logged in." } }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)"],
};
