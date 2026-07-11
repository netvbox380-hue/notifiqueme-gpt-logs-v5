export type DiagnosticLevel = "info" | "warn" | "error";

export type DiagnosticEntry = {
  id: string;
  at: string;
  level: DiagnosticLevel;
  source: string;
  message: string;
  details?: unknown;
  path?: string;
};

export type SystemDiagnosticSnapshot = {
  generatedAt: string;
  app: {
    url: string;
    userAgent: string;
    online: boolean;
    visibility: string;
    standalone: boolean;
  };
  push: {
    supported: boolean;
    permission: string;
    registrations: number;
    activeWorkers: number;
    subscriptions: number;
    controller: boolean;
    endpoints: string[];
    rawEndpoint?: string | null;
    serviceWorkerEvents: Array<{ at: string; type: string; details?: unknown }>;
  };
  storage: {
    localStorage: boolean;
    sessionStorage: boolean;
    caches: number | null;
  };
  network: {
    healthz: { ok: boolean; status?: number; elapsedMs?: number; error?: string };
  };
};

const STORAGE_KEY = "notifique-me:diagnostic-log:v1";
const CHANGE_EVENT = "notifique-me:diagnostic-log-changed";
const MAX_ENTRIES = 500;
let installed = false;

function safeString(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limit]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value
      .replace(/(authorization|cookie|token|secret|password|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[REDACTED]")
      .slice(0, 4000);
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.slice(0, 8000) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      if (/authorization|cookie|token|secret|password|private.?key/i.test(key)) out[key] = "[REDACTED]";
      else out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return safeString(value);
}

export function readDiagnosticLogs(): DiagnosticEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeDiagnosticLog(
  level: DiagnosticLevel,
  source: string,
  message: string,
  details?: unknown,
): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: new Date().toISOString(),
    level,
    source,
    message: message.slice(0, 1000),
    details: redact(details),
    path: typeof window !== "undefined" ? `${location.pathname}${location.search}` : undefined,
  };
  if (typeof window !== "undefined") {
    try {
      const items = [...readDiagnosticLogs(), entry].slice(-MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
      // O diagnóstico nunca deve quebrar o aplicativo.
    }
  }
  return entry;
}

export function clearDiagnosticLogs(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

export function subscribeDiagnosticLogs(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function installGlobalDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    writeDiagnosticLog("error", "console", safeString(args[0] ?? "Erro no console"), args.slice(1));
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    writeDiagnosticLog("warn", "console", safeString(args[0] ?? "Aviso no console"), args.slice(1));
    originalWarn(...args);
  };

  window.addEventListener("error", (event) => {
    writeDiagnosticLog("error", "window.error", event.message || "Erro JavaScript", {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    writeDiagnosticLog("error", "promise", "Promise rejeitada sem tratamento", event.reason);
  });

  window.addEventListener("online", () => writeDiagnosticLog("info", "network", "Conexão restaurada"));
  window.addEventListener("offline", () => writeDiagnosticLog("warn", "network", "Aplicativo ficou offline"));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      writeDiagnosticLog("info", "service-worker", "Controller do Service Worker alterado");
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      writeDiagnosticLog("info", "service-worker", `Mensagem recebida: ${String(event.data?.type || "sem-tipo")}`, event.data);
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = (() => {
      try { const u = new URL(rawUrl, location.origin); return `${u.origin}${u.pathname}`; } catch { return String(rawUrl).split("?")[0]; }
    })();
    const started = performance.now();
    try {
      const response = await nativeFetch(input, init);
      const elapsedMs = Math.round(performance.now() - started);
      if (!response.ok) writeDiagnosticLog("error", "http", `${method} ${url} retornou ${response.status}`, { status: response.status, elapsedMs });
      else if (elapsedMs >= 8000) writeDiagnosticLog("warn", "http", `${method} ${url} demorou ${elapsedMs}ms`, { elapsedMs });
      return response;
    } catch (error) {
      writeDiagnosticLog("error", "http", `${method} ${url} falhou`, { error, elapsedMs: Math.round(performance.now() - started) });
      throw error;
    }
  };

  writeDiagnosticLog("info", "diagnostics", "Monitor global iniciado", {
    version: "1",
    userAgent: navigator.userAgent,
  });
}

export async function runSystemDiagnostics(): Promise<SystemDiagnosticSnapshot> {
  const push = {
    supported: typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window,
    permission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
    registrations: 0,
    activeWorkers: 0,
    subscriptions: 0,
    controller: Boolean(navigator.serviceWorker?.controller),
    endpoints: [] as string[],
    rawEndpoint: null as string | null,
    serviceWorkerEvents: [] as Array<{ at: string; type: string; details?: unknown }>,
  };

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      push.registrations = registrations.length;
      for (const registration of registrations) {
        if (registration.active) push.activeWorkers += 1;
        try {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            push.subscriptions += 1;
            if (!push.rawEndpoint) push.rawEndpoint = subscription.endpoint;
            push.endpoints.push(subscription.endpoint.replace(/(.{28}).+(.{12})$/, "$1…$2"));
          }
        } catch (error) {
          writeDiagnosticLog("warn", "push-diagnostic", "Falha ao consultar subscription", error);
        }
      }
    } catch (error) {
      writeDiagnosticLog("error", "push-diagnostic", "Falha ao consultar Service Workers", error);
    }
  }

  if ("caches" in window) {
    try {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const response = await cache.match("/__sw_diagnostics.json");
        if (!response) continue;
        const payload = await response.json();
        if (Array.isArray(payload?.events)) {
          push.serviceWorkerEvents = payload.events.slice(-50);
          break;
        }
      }
    } catch (error) {
      writeDiagnosticLog("warn", "push-diagnostic", "Falha ao ler histórico do Service Worker", error);
    }
  }

  let cacheCount: number | null = null;
  try { cacheCount = "caches" in window ? (await caches.keys()).length : null; } catch {}

  const healthz: SystemDiagnosticSnapshot["network"]["healthz"] = { ok: false };
  const started = performance.now();
  try {
    const response = await fetch("/healthz", { cache: "no-store", credentials: "same-origin" });
    healthz.ok = response.ok;
    healthz.status = response.status;
    healthz.elapsedMs = Math.round(performance.now() - started);
  } catch (error) {
    healthz.error = error instanceof Error ? error.message : String(error);
    healthz.elapsedMs = Math.round(performance.now() - started);
  }

  const snapshot: SystemDiagnosticSnapshot = {
    generatedAt: new Date().toISOString(),
    app: {
      url: location.href,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      visibility: document.visibilityState,
      standalone: Boolean(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone),
    },
    push,
    storage: {
      localStorage: (() => { try { localStorage.setItem("__nm_diag", "1"); localStorage.removeItem("__nm_diag"); return true; } catch { return false; } })(),
      sessionStorage: (() => { try { sessionStorage.setItem("__nm_diag", "1"); sessionStorage.removeItem("__nm_diag"); return true; } catch { return false; } })(),
      caches: cacheCount,
    },
    network: { healthz },
  };

  writeDiagnosticLog(snapshot.network.healthz.ok ? "info" : "error", "diagnostics", "Diagnóstico executado", snapshot);
  return snapshot;
}

export function downloadDiagnosticReport(snapshot?: SystemDiagnosticSnapshot): void {
  const safeSnapshot = snapshot
    ? {
        ...snapshot,
        push: {
          ...snapshot.push,
          rawEndpoint: snapshot.push.rawEndpoint ? "[REDACTED]" : null,
        },
      }
    : null;
  const payload = {
    exportedAt: new Date().toISOString(),
    snapshot: safeSnapshot,
    logs: readDiagnosticLogs(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `notifiqueme-diagnostico-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
