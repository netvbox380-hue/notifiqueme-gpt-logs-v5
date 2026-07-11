export type PushPreferences = {
  vibrate: boolean;
  sound: boolean;
};

const PUSH_PREFERENCES_KEY = "nm_push_prefs";
const DEFAULT_PUSH_PREFERENCES: PushPreferences = {
  vibrate: true,
  sound: true,
};

export function loadPushPreferences(): PushPreferences {
  try {
    const raw = localStorage.getItem(PUSH_PREFERENCES_KEY);
    if (!raw) return DEFAULT_PUSH_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<PushPreferences> | null;
    return {
      vibrate: parsed?.vibrate !== false,
      sound: parsed?.sound !== false,
    };
  } catch {
    return DEFAULT_PUSH_PREFERENCES;
  }
}

export function savePushPreferences(preferences: PushPreferences): void {
  try {
    localStorage.setItem(PUSH_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {}

  navigator.serviceWorker?.controller?.postMessage({
    type: "SET_PUSH_PREFS",
    prefs: preferences,
  });
}

export function toWhatsAppUrl(phone?: string | null, message?: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const text = message?.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export async function setNativeBadge(count: number): Promise<void> {
  try {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (value?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) await badgeNavigator.setAppBadge?.(count);
    else await badgeNavigator.clearAppBadge?.();
  } catch {}

  navigator.serviceWorker?.controller?.postMessage({
    type: count > 0 ? "SET_BADGE" : "CLEAR_BADGE",
    ...(count > 0 ? { count } : {}),
  });
}
