// client/public/sw.js

const STATIC_CACHE = "notifique-me-static-v10";
const RUNTIME_CACHE = "notifique-me-runtime-v10";

// ⚠️ NÃO cachear "/" (pode redirect /login e quebrar install)
const PRECACHE_URLS = [
  "/index.html",
  "/manifest.json", // ✅ mesmo que o index.html usa
  "/icon-192.png",
  "/icon-512.png",
];

/* ============================
   ✅ BADGE helpers (Android/Chrome)
============================ */
async function setBadge(count) {
  try {
    if (self.registration && "setAppBadge" in self.registration) {
      await self.registration.setAppBadge(Number(count) || 0);
    }
  } catch {}
}

async function clearBadge() {
  try {
    if (self.registration && "clearAppBadge" in self.registration) {
      await self.registration.clearAppBadge();
    }
  } catch {}
}

/* ============================
   ✅ Push prefs (persistente via Cache)
   - Mantém preferências acessíveis no SW mesmo após restart.
============================ */
const PREFS_URL = "/__sw_prefs.json";

/* ============================
   Diagnóstico persistente do Service Worker
============================ */
const DIAGNOSTICS_URL = "/__sw_diagnostics.json";

async function recordSwDiagnostic(type, details = {}) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const previousResponse = await cache.match(DIAGNOSTICS_URL);
    const previous = previousResponse ? await previousResponse.json() : { events: [] };
    const events = Array.isArray(previous.events) ? previous.events : [];
    events.push({ at: new Date().toISOString(), type, details });
    await cache.put(
      DIAGNOSTICS_URL,
      new Response(JSON.stringify({ updatedAt: new Date().toISOString(), events: events.slice(-50) }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch {}
}

async function readPrefs() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const res = await cache.match(PREFS_URL);
    if (!res) return { vibrate: true, sound: true };
    const json = await res.json();
    return {
      vibrate: json?.vibrate !== false,
      sound: json?.sound !== false,
    };
  } catch {
    return { vibrate: true, sound: true };
  }
}

async function writePrefs(prefs) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const body = JSON.stringify({
      vibrate: prefs?.vibrate !== false,
      sound: prefs?.sound !== false,
      updatedAt: Date.now(),
    });
    await cache.put(PREFS_URL, new Response(body, { headers: { "Content-Type": "application/json" } }));
  } catch {}
}

/* ============================
   ✅ MESSAGES from app
============================ */
self.addEventListener("message", (event) => {
  const data = event?.data || {};

  if (data.type === "SKIP_WAITING") self.skipWaiting();

  // ✅ Atualiza badge vindo do app (ex: inboxCount)
  if (data.type === "SET_BADGE") void setBadge(data.count);

  if (data.type === "CLEAR_BADGE") void clearBadge();

  // ✅ Preferências para o SW (vibração/som)
  if (data.type === "SET_PUSH_PREFS") void writePrefs(data.prefs || {});

  // ✅ Badge nativo (Android): remove da bandeja a(s) notificação(ões) já lida(s)
  // no app, pra que o badge derivado de notificações ativas fique sempre
  // coerente com o que o usuário já viu — funciona em qualquer fabricante,
  // sem depender de API proprietária nenhuma.
  if (data.type === "CLOSE_NOTIFICATIONS" && Array.isArray(data.deliveryIds)) {
    const ids = data.deliveryIds.map((id) => String(id));
    event.waitUntil(
      (async () => {
        try {
          const notifs = await self.registration.getNotifications();
          notifs
            .filter((n) => ids.includes(String(n.tag)))
            .forEach((n) => n.close());
        } catch {}
      })()
    );
  }

  // ✅ "Marcar todas como lidas": limpa a bandeja inteira do app.
  if (data.type === "CLOSE_ALL_NOTIFICATIONS") {
    event.waitUntil(
      (async () => {
        try {
          const notifs = await self.registration.getNotifications();
          notifs.forEach((n) => n.close());
        } catch {}
      })()
    );
  }
});

/* ============================
   ✅ INSTALL / ACTIVATE (seu código)
============================ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await recordSwDiagnostic("install");
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(PRECACHE_URLS);
      } catch (error) {
        await recordSwDiagnostic("install-cache-warning", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
      await recordSwDiagnostic("activate", { cache: RUNTIME_CACHE });
    })()
  );
});

/* ============================
   ✅ PUSH: mostra notificação + atualiza badge
============================ */
self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {};
    }
  })();



  const title = payload.title || "Notifique-me";
  const body = payload.body || payload.content || "Você recebeu uma nova mensagem";
  const url = payload.url || "/my-notifications";

  // ✅ suporte a push "silencioso" (atualiza badge/estado sem notificação)
  const silent = Boolean(payload.silent);

  // backend vai mandar badgeCount (ideal). fallback: badge
  const badgeCount = Number(payload.badgeCount ?? payload.badge ?? 0) || 0;

  event.waitUntil(
    (async () => {
      await recordSwDiagnostic("push-received", {
        notificationId: payload.notificationId ?? null,
        deliveryId: payload.deliveryId ?? null,
        badgeCount,
        silent,
        title,
      });

      if (badgeCount > 0) await setBadge(badgeCount);

      // ✅ Ping/monitor: avisa clientes abertos
      try {
        const allClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of allClients) {
          client.postMessage({
            type: "PUSH_PING",
            ts: Date.now(),
            badgeCount,
            silent,
            title,
            body,
            url,
          });
        }
      } catch {}

      await recordSwDiagnostic("push-ping-dispatched", {
        notificationId: payload.notificationId ?? null,
        deliveryId: payload.deliveryId ?? null,
      });

      if (silent) {
        await recordSwDiagnostic("push-silent-complete", {
          notificationId: payload.notificationId ?? null,
        });
        return;
      }

      const prefs = await readPrefs();

      await self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        // ✅ tag = deliveryId: permite fechar essa notificação específica da
        // bandeja quando o usuário marcar como lida no app (badge nativo do
        // Android fica coerente, sem depender de fabricante).
        tag: payload.deliveryId != null ? String(payload.deliveryId) : undefined,
        data: {
          url,
          deliveryId: payload.deliveryId ?? null,
          notificationId: payload.notificationId ?? null,
        },
        // vibração é best-effort e respeita configurações do sistema
        vibrate: prefs.vibrate ? [80, 40, 80] : undefined,
      });

      await recordSwDiagnostic("notification-shown", {
        notificationId: payload.notificationId ?? null,
        deliveryId: payload.deliveryId ?? null,
        badgeCount,
      });
    })()
  );
});

/* ============================
   ✅ Clique na notificação abre o app
============================ */
self.addEventListener("notificationclick", (event) => {
  const url = event?.notification?.data?.url || "/";
  const deliveryId = event?.notification?.data?.deliveryId ?? null;
  const notificationId = event?.notification?.data?.notificationId ?? null;
  event.notification.close();

  event.waitUntil(
    (async () => {
      await recordSwDiagnostic("notification-clicked", { url, deliveryId, notificationId });
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Se já tiver o app/aba aberta, foca e navega
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          // para SPA: manda mensagem para o client navegar
          client.postMessage({ type: "NAVIGATE", url });
          return;
        }
      }

      // senão, abre nova janela
      await self.clients.openWindow(url);
    })()
  );
});

/* ============================
   ✅ FETCH (seu código)
============================ */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (!url.protocol.startsWith("http")) return;

  // API nunca cacheia
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  // Navegação SPA
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cachedIndex = await caches.match("/index.html");
        return cachedIndex || new Response("Offline", { status: 503 });
      })
    );
    return;
  }

  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }

  // Assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
