/* Pi Web Service Worker
 *
 * STRATEGY: This SW does NOT intercept any fetch events.
 *
 * Pi Web is a server-rendered app that requires a live connection to the
 * Mac running the Pi agent. There is no meaningful offline mode — sessions,
 * chat, auth, and SSE all require the server. Caching HTML or API responses
 * would cause stale content and break streaming.
 *
 * The SW exists to:
 *   1. Satisfy the browser requirement for "Install to Home Screen" on Android Chrome.
 *   2. Provide a version-based update mechanism so future iterations can
 *      safely invalidate without leaving stale workers.
 *   3. Display completion notifications delivered through Web Push.
 *
 * All requests pass through to the network unmodified.
 */

const SW_VERSION = "1.1.1";

self.addEventListener("install", () => {
  // Skip waiting so the new SW activates immediately on update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all open clients so the new SW takes control right away.
  event.waitUntil(self.clients.claim());
});

// No fetch handler — all requests go to the network.

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = {};
    }

    const title = typeof payload.title === "string" ? payload.title : "Pi 已完成";
    const options = {
      body: typeof payload.body === "string" ? payload.body : "任务已完成。",
      icon: typeof payload.icon === "string" ? payload.icon : "/icon-192x192.png",
      badge: typeof payload.badge === "string" ? payload.badge : "/icon-192x192.png",
      tag: typeof payload.tag === "string" ? payload.tag : "pi-complete",
      data: payload.data && typeof payload.data === "object" ? payload.data : { url: "/" },
    };

    await self.registration.showNotification(title, options);
    if ("setAppBadge" in self.navigator) {
      await self.navigator.setAppBadge(1).catch(() => {});
    }

    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: "PI_PUSH_DELIVERED" });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    if ("clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge().catch(() => {});
    }

    const path = typeof event.notification.data?.url === "string"
      ? event.notification.data.url
      : "/";
    const url = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      if ("navigate" in existing) await existing.navigate(url);
      await existing.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// Allow the page to query the SW version for diagnostics.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_SW_VERSION") {
    event.source.postMessage({ type: "SW_VERSION", version: SW_VERSION });
  }
});
