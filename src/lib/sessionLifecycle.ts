import { getDesktopStorage } from "@/lib/desktopBridge";

export const SESSION_POLICY_DAYS = 30;
const SESSION_POLICY_SECONDS = SESSION_POLICY_DAYS * 24 * 60 * 60;
const NO_REMEMBER_POLICY_SECONDS = 24 * 60 * 60;

export const SESSION_META_KEY = "promo.session.lifecycle";
export const SESSION_FLAG_KEY = "promo.session.flag";

export type SessionLifecycleMeta = {
  sessionStartedAt: number;
  lastRefreshAt: number;
  expiresPolicyAt: number;
  rememberEnabled: boolean;
  quickUnlockEnabled: boolean;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const computePolicyExpiration = (startedAt: number, rememberEnabled: boolean) =>
  startedAt + (rememberEnabled ? SESSION_POLICY_SECONDS : NO_REMEMBER_POLICY_SECONDS);

export const readSessionMeta = (): SessionLifecycleMeta | null => {
  const storage = getDesktopStorage();
  if (!storage) return null;
  const raw = storage.getItem(SESSION_META_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as SessionLifecycleMeta;
    if (
      typeof parsed.sessionStartedAt !== "number" ||
      typeof parsed.expiresPolicyAt !== "number" ||
      typeof parsed.lastRefreshAt !== "number"
    ) {
      return null;
    }
    return {
      ...parsed,
      rememberEnabled: parsed.rememberEnabled !== false,
      quickUnlockEnabled: parsed.quickUnlockEnabled !== false,
    };
  } catch {
    return null;
  }
};

export const writeSessionMeta = (meta: SessionLifecycleMeta) => {
  const storage = getDesktopStorage();
  if (!storage) return;
  storage.setItem(SESSION_META_KEY, JSON.stringify(meta));
};

export const clearSessionMeta = () => {
  const storage = getDesktopStorage();
  if (!storage) return;
  storage.removeItem(SESSION_META_KEY);
};

export const ensureSessionMeta = (
  current: SessionLifecycleMeta | null,
  options?: { rememberEnabled?: boolean; quickUnlockEnabled?: boolean },
): SessionLifecycleMeta => {
  const now = nowSeconds();
  const rememberEnabled = options?.rememberEnabled ?? current?.rememberEnabled ?? true;
  const quickUnlockEnabled = options?.quickUnlockEnabled ?? current?.quickUnlockEnabled ?? true;
  const startedAt = current?.sessionStartedAt ?? now;
  return {
    sessionStartedAt: startedAt,
    lastRefreshAt: now,
    expiresPolicyAt: computePolicyExpiration(startedAt, rememberEnabled),
    rememberEnabled,
    quickUnlockEnabled,
  };
};

export const isSessionExpiredByPolicy = (meta: SessionLifecycleMeta | null): boolean => {
  if (!meta) return false;
  return nowSeconds() > meta.expiresPolicyAt;
};

export const markSessionExpiredFlag = () => {
  const storage = getDesktopStorage();
  if (!storage) return;
  storage.setItem(
    SESSION_FLAG_KEY,
    JSON.stringify({
      reason: "policy_expired",
      at: new Date().toISOString(),
    }),
  );
};

export const consumeSessionFlag = (): { reason: string; at: string } | null => {
  const storage = getDesktopStorage();
  if (!storage) return null;
  const raw = storage.getItem(SESSION_FLAG_KEY);
  storage.removeItem(SESSION_FLAG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { reason: string; at: string };
  } catch {
    return null;
  }
};

