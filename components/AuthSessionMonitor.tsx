"use client";

import { useEffect } from "react";

function loginUrl(expired: boolean): string {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({ next });
  if (expired) params.set("expired", "1");
  return `/login?${params.toString()}`;
}

function isProtectedApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = input instanceof Request ? input.url : input.toString();
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin
      && url.pathname.startsWith("/api/")
      && url.pathname !== "/api/auth/session";
  } catch {
    return false;
  }
}

/**
 * A PWA may stay alive longer than its authentication cookie. Fetch failures
 * are redirected immediately; a small heartbeat also covers EventSource/SSE
 * reconnects, which do not expose their HTTP status to browser JavaScript.
 */
export function AuthSessionMonitor() {
  useEffect(() => {
    let redirecting = false;
    let stopped = false;
    const nativeFetch = window.fetch.bind(window);

    const redirectToLogin = () => {
      if (redirecting || window.location.pathname === "/login") return;
      redirecting = true;
      window.location.replace(loginUrl(true));
    };

    const wrappedFetch: typeof window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (
        response.status === 401
        && response.headers.get("X-Pi-Web-Auth-Required") === "1"
        && isProtectedApiRequest(args[0])
      ) {
        redirectToLogin();
      }
      return response;
    };
    window.fetch = wrappedFetch;

    const checkSession = async () => {
      try {
        const response = await nativeFetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!stopped && response.status === 401) redirectToLogin();
      } catch {
        // Offline and transient relay failures are not authentication failures.
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    const interval = window.setInterval(() => void checkSession(), 60_000);
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("online", checkSession);
    window.addEventListener("pageshow", checkSession);
    void checkSession();

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("online", checkSession);
      window.removeEventListener("pageshow", checkSession);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
