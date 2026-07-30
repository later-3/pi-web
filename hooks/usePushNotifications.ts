"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/types";

export type PushNotificationStatus =
  | "checking"
  | "unsupported"
  | "off"
  | "unverified"
  | "enabling"
  | "on"
  | "disabling"
  | "denied"
  | "error";

function supported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(value: ArrayBuffer | null): string | null {
  if (!value) return null;
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchPublicKey(): Promise<string> {
  const response = await fetch("/api/push", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { publicKey?: string; error?: string };
  if (!response.ok || !body.publicKey) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.publicKey;
}

async function saveSubscription(subscription: PushSubscription, locale: Locale, test: boolean): Promise<boolean> {
  const response = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), locale, test }),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; verified?: boolean };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.verified === true;
}

async function deleteSubscription(endpoint: string): Promise<void> {
  const response = await fetch("/api/push", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export function usePushNotifications(locale: Locale) {
  const [status, setStatus] = useState<PushNotificationStatus>("checking");
  const mountedRef = useRef(true);
  const operationRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let syncing = false;

    const syncStatus = async () => {
      if (syncing || operationRef.current) return;
      if (!supported()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }

      syncing = true;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          if (!cancelled) setStatus("off");
          return;
        }

        const publicKey = await fetchPublicKey();
        const subscribedKey = bytesToBase64Url(subscription.options.applicationServerKey);
        if (subscribedKey !== publicKey) {
          await subscription.unsubscribe();
          if (!cancelled) setStatus("off");
          return;
        }

        const verified = await saveSubscription(subscription, locale, false);
        if (!cancelled) setStatus(verified ? "on" : "unverified");
      } catch (error) {
        console.error("Failed to restore push subscription:", error);
        if (!cancelled) setStatus("error");
      } finally {
        syncing = false;
      }
    };

    const requestSync = () => {
      if (document.visibilityState !== "hidden") void syncStatus();
    };
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "PI_PUSH_DELIVERED") requestSync();
    };

    window.addEventListener("pageshow", requestSync);
    window.addEventListener("online", requestSync);
    document.addEventListener("visibilitychange", requestSync);
    navigator.serviceWorker.addEventListener("message", handleWorkerMessage);
    void syncStatus();

    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", requestSync);
      window.removeEventListener("online", requestSync);
      document.removeEventListener("visibilitychange", requestSync);
      navigator.serviceWorker.removeEventListener("message", handleWorkerMessage);
    };
  }, [locale]);

  const toggle = useCallback(async () => {
    if (!supported() || status === "checking" || status === "enabling" || status === "disabling") return;

    operationRef.current = true;
    try {
      if (status === "on") {
        setStatus("disabling");
        const registration = await navigator.serviceWorker.ready;
        const current = await registration.pushManager.getSubscription();
        if (!current) {
          if (mountedRef.current) setStatus("off");
          return;
        }
        const endpoint = current.endpoint;
        await current.unsubscribe();
        await deleteSubscription(endpoint).catch(() => {});
        if (mountedRef.current) setStatus("off");
        return;
      }

      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      setStatus("enabling");

      // Keep this as the first awaited browser API: iOS requires the permission
      // request to happen directly in the user's tap handler.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (mountedRef.current) setStatus(permission === "denied" ? "denied" : "off");
        return;
      }

      const publicKey = await fetchPublicKey();
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && bytesToBase64Url(subscription.options.applicationServerKey) !== publicKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(publicKey),
        });
      const verified = await saveSubscription(subscription, locale, true).catch(async (error) => {
        // A fresh test can fail transiently even when an earlier completion
        // notification already proved this exact subscription. Reconcile with
        // the server before replacing a known-good state with red.
        const previouslyVerified = await saveSubscription(subscription, locale, false).catch(() => false);
        if (previouslyVerified) return true;
        throw error;
      });
      if (mountedRef.current) setStatus(verified ? "on" : "unverified");
    } catch (error) {
      console.error("Failed to toggle push notifications:", error);
      if (mountedRef.current) setStatus("error");
    } finally {
      operationRef.current = false;
    }
  }, [locale, status]);

  return { pushStatus: status, onPushToggle: toggle };
}
