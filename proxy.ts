import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import {
  getWebAuthConfig,
  isPublicWebAuthPath,
  readCookieValue,
  sanitizeWebAuthNext,
  verifyWebAuthToken,
} from "@/lib/web-auth";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApiRequest = pathname.startsWith("/api/");

  if (isApiRequest && !isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  if (isPublicWebAuthPath(pathname)) return NextResponse.next();

  const config = getWebAuthConfig();
  if (config.state === "disabled") return NextResponse.next();
  if (config.state === "misconfigured") {
    if (isApiRequest) {
      return NextResponse.json({ error: "Pi Web login is not configured correctly" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new NextResponse("Pi Web login is not configured correctly", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const verification = verifyWebAuthToken(config, readCookieValue(request));
  if (verification.valid) return NextResponse.next();

  if (isApiRequest) {
    return NextResponse.json({ error: "Authentication required" }, {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "X-Pi-Web-Auth-Required": "1",
      },
    });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", sanitizeWebAuthNext(`${pathname}${search}`));
  if (verification.reason !== "missing") loginUrl.searchParams.set("expired", "1");
  const response = NextResponse.redirect(loginUrl);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  matcher: "/:path*",
};
