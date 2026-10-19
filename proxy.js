import { NextResponse } from "next/server";

// Optimistic check only: redirect obviously signed-out visitors to /login.
// Real authentication and authorisation happen on the server for every page and API call.
const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/health"];

export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  const hasCookie = request.cookies.has("hms_session");
  if (!hasCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|icons/).*)"],
};
