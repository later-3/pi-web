function firstForwardedValue(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

/**
 * Resolves the browser-visible origin behind a trusted reverse proxy.
 * This is metadata only; Host/Origin authorization remains in request-security.
 */
export function getExternalRequestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? `${forwardedProto}:`
    : requestUrl.protocol;
  const host = request.headers.get("host")?.trim();

  if (host && !/[\s/@\\]/.test(host)) {
    try {
      const external = new URL(`${protocol}//${host}`);
      if (!external.username && !external.password && external.pathname === "/") {
        return external.origin;
      }
    } catch {
      // Fall back to the server request URL.
    }
  }

  return requestUrl.origin;
}

export function isExternalRequestSecure(request: Request): boolean {
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  if (forwardedProto === "https") return true;
  if (forwardedProto === "http") return false;
  return new URL(request.url).protocol === "https:";
}
