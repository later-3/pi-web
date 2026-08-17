/* Pi Web Service Worker
 *
 * Live pages and all API/SSE traffic remain network-only. The worker caches
 * only versioned static assets plus a small offline fallback, and also owns
 * Web Push delivery for completed agent runs.
 */

const CACHE_PREFIX = "pi-web";
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication, session data, and live agent traffic must never be cached.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match(OFFLINE_URL);
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE_URLS.includes(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/";
  let targetUrl = new URL("/", self.location.origin);
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Keep the root URL when notification data is malformed.
  }

  event.waitUntil(focusOrOpenWindow(targetUrl.href));
});

async function focusOrOpenWindow(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const exactClient = windowClients.find((client) => client.url === targetUrl);
  const candidates = exactClient
    ? [exactClient, ...windowClients.filter((client) => client !== exactClient)]
    : windowClients;

  for (const client of candidates) {
    try {
      const targetClient = client.url === targetUrl
        ? client
        : (await client.navigate(targetUrl)) ?? client;
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

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
      icon: typeof payload.icon === "string" ? payload.icon : "/icons/icon-192.png",
      badge: typeof payload.badge === "string" ? payload.badge : "/icons/icon-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : "pi-complete",
      data: payload.data && typeof payload.data === "object" ? payload.data : { url: "/" },
    };

    await self.registration.showNotification(title, options);
    if (self.navigator && "setAppBadge" in self.navigator) {
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

  const requestedUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/";
  let targetUrl = new URL("/", self.location.origin);
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Keep the root URL when notification data is malformed.
  }

  event.waitUntil((async () => {
    if (self.navigator && "clearAppBadge" in self.navigator) {
      await self.navigator.clearAppBadge().catch(() => {});
    }
    await focusOrOpenWindow(targetUrl.href);
  })());
});

async function focusOrOpenWindow(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const exactClient = windowClients.find((client) => client.url === targetUrl);
  const candidates = exactClient
    ? [exactClient, ...windowClients.filter((client) => client !== exactClient)]
    : windowClients;

  for (const client of candidates) {
    try {
      const targetClient = client.url === targetUrl
        ? client
        : (await client.navigate(targetUrl)) ?? client;
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_SW_VERSION") {
    event.source?.postMessage({ type: "SW_VERSION", version: CACHE_VERSION });
  }
});
