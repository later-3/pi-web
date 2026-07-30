import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import webpush, { type PushSubscription } from "web-push";

export type PushLocale = "en" | "zh-CN";

interface StoredPushSubscription extends PushSubscription {
  id: string;
  account: string;
  locale: PushLocale;
  vapidSubject: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
}

interface PushStore {
  version: 1;
  vapid: {
    publicKey: string;
    privateKey: string;
  };
  subscriptions: StoredPushSubscription[];
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface CompletionPushInput {
  sessionId: string;
  sessionName?: string | null;
  cwd?: string | null;
  lastAssistantText?: string | null;
}

interface NotificationPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: { url: string };
}

const STORE_FILE = "pi-web-push.json";
const MAX_PREVIEW_CHARACTERS = 120;

function storePath(): string {
  return join(getAgentDir(), STORE_FILE);
}

function emptyStore(): PushStore {
  return {
    version: 1,
    vapid: webpush.generateVAPIDKeys(),
    subscriptions: [],
  };
}

function isPushStore(value: unknown): value is PushStore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PushStore>;
  return candidate.version === 1
    && typeof candidate.vapid?.publicKey === "string"
    && typeof candidate.vapid?.privateKey === "string"
    && Array.isArray(candidate.subscriptions);
}

function readStore(): PushStore | null {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    if (!isPushStore(parsed)) throw new Error("Push notification store has an unsupported format");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

function writeStore(store: PushStore): void {
  const path = storePath();
  mkdirSync(getAgentDir(), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function getOrCreateStore(): PushStore {
  const current = readStore();
  if (current) return current;
  const created = emptyStore();
  writeStore(created);
  return created;
}

function validBase64Url(value: string): boolean {
  return value.length >= 8 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function normalizePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PushSubscriptionInput>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 4096) return null;
  try {
    if (new URL(candidate.endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (!candidate.keys || typeof candidate.keys !== "object") return null;
  if (typeof candidate.keys.p256dh !== "string" || !validBase64Url(candidate.keys.p256dh)) return null;
  if (typeof candidate.keys.auth !== "string" || !validBase64Url(candidate.keys.auth)) return null;
  if (candidate.expirationTime !== undefined
    && candidate.expirationTime !== null
    && (!Number.isFinite(candidate.expirationTime) || candidate.expirationTime < 0)) {
    return null;
  }
  return {
    endpoint: candidate.endpoint,
    expirationTime: candidate.expirationTime ?? null,
    keys: { p256dh: candidate.keys.p256dh, auth: candidate.keys.auth },
  };
}

function normalizeLocale(value: unknown): PushLocale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function normalizeVapidSubject(value: string): string {
  const configured = process.env.PI_WEB_PUSH_SUBJECT?.trim();
  if (configured && (/^mailto:[^\s@]+@[^\s@]+$/i.test(configured) || /^https:\/\//i.test(configured))) {
    return configured;
  }
  if (/^https:\/\//i.test(value)) return value;
  return "mailto:pi-web@localhost.local";
}

export function getPushPublicKey(): string {
  return getOrCreateStore().vapid.publicKey;
}

export function savePushSubscription(
  account: string,
  subscription: PushSubscriptionInput,
  options: { locale?: unknown; vapidSubject: string },
): StoredPushSubscription {
  const store = getOrCreateStore();
  const now = new Date().toISOString();
  const existing = store.subscriptions.find((item) => item.endpoint === subscription.endpoint);
  const sameKeys = existing?.keys.p256dh === subscription.keys.p256dh
    && existing?.keys.auth === subscription.keys.auth;
  const saved: StoredPushSubscription = {
    ...subscription,
    id: existing?.id ?? randomUUID(),
    account,
    locale: normalizeLocale(options.locale),
    vapidSubject: normalizeVapidSubject(options.vapidSubject),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(sameKeys && existing?.verifiedAt ? { verifiedAt: existing.verifiedAt } : {}),
  };
  store.subscriptions = [
    ...store.subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
    saved,
  ];
  writeStore(store);
  return saved;
}

function markPushSubscriptionVerified(endpoint: string): void {
  const store = readStore();
  if (!store) return;
  const subscription = store.subscriptions.find((item) => item.endpoint === endpoint);
  if (!subscription) return;
  subscription.verifiedAt = new Date().toISOString();
  writeStore(store);
}

export function removePushSubscription(account: string, endpoint: string): boolean {
  const store = readStore();
  if (!store) return false;
  const next = store.subscriptions.filter((item) => !(item.account === account && item.endpoint === endpoint));
  if (next.length === store.subscriptions.length) return false;
  store.subscriptions = next;
  writeStore(store);
  return true;
}

function subscriptionForSend(subscription: StoredPushSubscription): PushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: subscription.keys,
  };
}

async function sendPayload(store: PushStore, subscription: StoredPushSubscription, payload: NotificationPayload): Promise<void> {
  await webpush.sendNotification(subscriptionForSend(subscription), JSON.stringify(payload), {
    vapidDetails: {
      subject: subscription.vapidSubject,
      publicKey: store.vapid.publicKey,
      privateKey: store.vapid.privateKey,
    },
    TTL: 60 * 60,
    urgency: "normal",
    topic: buildWebPushTopic(payload.tag),
    timeout: 15_000,
  });
}

/**
 * Apple Web Push rejects short Topic headers with `BadWebPushTopic`. A stable
 * 32-character base64url digest works across Apple's and standard push
 * services while preserving notification collapsing for the same tag.
 */
export function buildWebPushTopic(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
}

function isExpiredPushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

function forgetEndpoints(endpoints: string[]): void {
  if (endpoints.length === 0) return;
  const store = readStore();
  if (!store) return;
  const expired = new Set(endpoints);
  store.subscriptions = store.subscriptions.filter((item) => !expired.has(item.endpoint));
  writeStore(store);
}

export async function sendPushTest(subscription: StoredPushSubscription): Promise<void> {
  const store = getOrCreateStore();
  const chinese = subscription.locale === "zh-CN";
  await sendPayload(store, subscription, {
    title: chinese ? "Pi 推送已开启" : "Pi notifications enabled",
    body: chinese ? "任务完成后，你会在这里收到通知。" : "You will be notified here when a task finishes.",
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    tag: "pi-push-ready",
    data: { url: "/" },
  });
  markPushSubscriptionVerified(subscription.endpoint);
}

function plainTextPreview(value: string | null | undefined): string {
  const text = (value ?? "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, " "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*])\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = [...text];
  return characters.length <= MAX_PREVIEW_CHARACTERS
    ? text
    : `${characters.slice(0, MAX_PREVIEW_CHARACTERS).join("")}…`;
}

export function buildCompletionPayload(input: CompletionPushInput, locale: PushLocale): NotificationPayload {
  const chinese = locale === "zh-CN";
  const rawLabel = input.sessionName?.trim() || (input.cwd ? basename(input.cwd) : "Pi");
  const labelCharacters = [...rawLabel.replace(/\s+/g, " ")];
  const label = labelCharacters.length <= 48
    ? labelCharacters.join("")
    : `${labelCharacters.slice(0, 48).join("")}…`;
  const preview = plainTextPreview(input.lastAssistantText);
  return {
    title: chinese ? "Pi 已完成" : "Pi finished",
    body: preview
      ? `${label} · ${preview}`
      : chinese ? `${label} 已完成` : `${label} finished`,
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    tag: `pi-session-${input.sessionId}`,
    data: { url: `/?session=${encodeURIComponent(input.sessionId)}` },
  };
}

export async function sendCompletionPush(account: string, input: CompletionPushInput): Promise<number> {
  const store = readStore();
  if (!store) return 0;
  const subscriptions = store.subscriptions.filter((item) => item.account === account);
  const expired: string[] = [];
  let delivered = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await sendPayload(store, subscription, buildCompletionPayload(input, subscription.locale));
      delivered += 1;
      markPushSubscriptionVerified(subscription.endpoint);
    } catch (error) {
      if (isExpiredPushError(error)) expired.push(subscription.endpoint);
      else console.error("[pi-web] failed to send completion push:", error instanceof Error ? error.message : error);
    }
  }));

  forgetEndpoints(expired);
  return delivered;
}
