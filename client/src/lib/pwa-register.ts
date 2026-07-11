// Registro do Service Worker para PWA (sem interceptar /api e sem quebrar POST)
// Base preservada do projeto estável, com melhoria segura para remover SWs antigos
// incompatíveis e garantir o /sw.js como único registro do app.

async function cleanupOldRegistrations() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const regs = await navigator.serviceWorker.getRegistrations();

    for (const reg of regs) {
      const scriptUrl =
        (reg.active && reg.active.scriptURL) ||
        (reg.waiting && reg.waiting.scriptURL) ||
        (reg.installing && reg.installing.scriptURL) ||
        "";

      const pathname = scriptUrl ? new URL(scriptUrl).pathname : "";
      if (pathname && pathname !== "/sw.js") {
        await reg.unregister();
      }
    }
  } catch (error) {
    console.warn("Falha ao limpar Service Workers antigos:", error);
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    await cleanupOldRegistrations();

    const existing =
      (await navigator.serviceWorker.getRegistration("/")) ||
      (await navigator.serviceWorker.getRegistration());

    const currentScriptUrl =
      (existing?.active && existing.active.scriptURL) ||
      (existing?.waiting && existing.waiting.scriptURL) ||
      (existing?.installing && existing.installing.scriptURL) ||
      "";
    const currentPath = currentScriptUrl ? new URL(currentScriptUrl).pathname : "";

    if (existing && (!currentPath || currentPath === "/sw.js")) {
      try {
        await existing.update();
      } catch {}
      return existing;
    }

    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration;
  } catch (error) {
    console.warn("Falha ao registrar Service Worker:", error);
    return null;
  }
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
}
