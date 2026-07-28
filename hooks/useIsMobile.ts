"use client";

import { useSyncExternalStore } from "react";

// Shared with app/globals.css. The second clause keeps a phone in compact
// mode when landscape width exceeds 768px.
export const MOBILE_QUERY = "(max-width: 768px), (hover: none) and (pointer: coarse) and (max-height: 500px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
