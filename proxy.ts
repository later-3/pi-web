import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  getWebAuthConfig,
  isPublicWebAuthPath,
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  readCookieValue,
  sanitizeWebAuthNext,
  verifyWebAuthToken,
} from "@/lib/web-auth";

function unavailable(isApiRequest: boolean, message: string): NextResponse {
  if (isApiRequest) {
    return NextResponse.json({ error: message }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(message, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) return new NextResponse("Untrusted request", { status: 403 });
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const config = getWebAuthConfig();
  const basicPassword = process.env.PI_WEB_PASSWORD;
  const basicEnabled = isWebPasswordEnabled(basicPassword);
  const isBasicProtectedPath = pathname === "/" || isApiRequest;

  // Native Basic Auth is useful for simple upstream deployments, while the
  // signed app session is required for installed PWA recovery and accounts.
  // Stacking them makes API/SSE recovery ambiguous, so fail closed instead.
  if (basicEnabled && config.state !== "disabled") {
    return unavailable(isApiRequest, "Configure either PI_WEB_PASSWORD or PI_WEB_AUTH_*, not both");
  }

  if (basicEnabled) {
    // Match the upstream Basic Auth boundary: protect the app entry point and
    // APIs while leaving immutable framework assets available to the browser.
    if (!isBasicProtectedPath) return NextResponse.next();
    if (isValidBasicAuthorization(request.headers.get("authorization"), basicPassword)) {
      return NextResponse.next();
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  if (isPublicWebAuthPath(pathname)) return NextResponse.next();
  if (config.state === "disabled") return NextResponse.next();
  if (config.state === "misconfigured") {
    return unavailable(isApiRequest, "Pi Web login is not configured correctly");
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
