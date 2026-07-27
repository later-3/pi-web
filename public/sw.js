/* Pi Web Service Worker
 *
 * STRATEGY: This SW does NOT intercept any fetch events.
 *
 * Pi Web is a server-rendered app that requires a live connection to the
 * Mac running the Pi agent. There is no meaningful offline mode — sessions,
 * chat, auth, and SSE all require the server. Caching HTML or API responses
 * would cause stale content and break streaming.
 *
 * The SW exists only to:
 *   1. Satisfy the browser requirement for "Install to Home Screen" on Android Chrome.
 *   2. Provide a version-based update mechanism so future iterations can
 *      safely invalidate without leaving stale workers.
 *
 * All requests pass through to the network unmodified.
 */

const SW_VERSION = "1.0.0";

self.addEventListener("install", () => {
  // Skip waiting so the new SW activates immediately on update.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all open clients so the new SW takes control right away.
  event.waitUntil(self.clients.claim());
});

// No fetch handler — all requests go to the network.
// No push/message handlers — not needed.

// Allow the page to query the SW version for diagnostics.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_SW_VERSION") {
    event.source.postMessage({ type: "SW_VERSION", version: SW_VERSION });
  }
});
