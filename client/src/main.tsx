import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { installGlobalDiagnostics, writeDiagnosticLog } from "@/lib/diagnostics";

installGlobalDiagnostics();

const queryClient = new QueryClient();

// Captura o prompt de instalação o mais cedo possível para não perder o evento no mobile
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    (window as any).__nmBeforeInstallPrompt = e;
  });

  window.addEventListener("appinstalled", () => {
    try {
      delete (window as any).__nmBeforeInstallPrompt;
    } catch {}
  });
}


const handleApiError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (isUnauthorized) {
    console.warn("[Auth] Sessão expirada ou inválida.");

    if (window.location.pathname !== "/login") {
      console.log("[Auth] Redirecionando para login...");
      window.location.href = "/login";
    }
  }
};

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleApiError(error);
    writeDiagnosticLog("error", "trpc.query", "Falha em consulta da API", error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe((event) => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleApiError(error);
    writeDiagnosticLog("error", "trpc.mutation", "Falha em alteração da API", error);
    console.error("[API Mutation Error]", error);
  }
});

const baseUrl = window.location.origin || "http://localhost:3000";

const trpcClient = trpc.createClient({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${baseUrl}/api/trpc`,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </trpc.Provider>
);

/**
 * PWA / Service Worker
 * - Em PROD registra /sw.js
 * - Faz update do SW sem “prender” o app em bundle antigo.
 * - ✅ Recebe NAVIGATE do SW ao clicar na notificação (SPA)
 */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  // evita reload infinito
  const RELOAD_KEY = "__pwa_sw_reloaded__";
  const markReloaded = () => sessionStorage.setItem(RELOAD_KEY, "1");
  const hasReloaded = () => sessionStorage.getItem(RELOAD_KEY) === "1";
  const clearReloaded = () => sessionStorage.removeItem(RELOAD_KEY);

  const skipWaiting = async (reg: ServiceWorkerRegistration) => {
    if (!reg.waiting) return;
    try {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (e) {
      console.warn("[PWA] Não foi possível enviar SKIP_WAITING:", e);
    }
  };

  // ✅ navegação SPA (wouter usa history.pushState)
  const navigateSpa = (url: string) => {
    try {
      if (!url || typeof url !== "string") return;
      if (window.location.pathname === url) return;

      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // fallback duro
      window.location.href = url;
    }
  };

  try {
    // ✅ Migração segura: se existir SW antigo (ex: /service-worker.js), remove para evitar "offline" ao instalar o PWA
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        const scriptUrl =
          (r.active && r.active.scriptURL) ||
          (r.waiting && r.waiting.scriptURL) ||
          (r.installing && r.installing.scriptURL) ||
          "";
        const pathname = scriptUrl ? new URL(scriptUrl).pathname : "";
        // mantém apenas o SW atual
        if (pathname && pathname !== "/sw.js") {
          await r.unregister();
        }
      }
    } catch {
      // ignore
    }

    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // ✅ Se clicar em notificação, SW manda NAVIGATE -> aqui navega na SPA
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event?.data || {};
      if (data?.type === "NAVIGATE" && typeof data.url === "string") {
        console.log("[PWA] NAVIGATE recebido do SW:", data.url);
        navigateSpa(data.url);
      }
    });

    // se já tem uma versão esperando, tenta ativar
    await skipWaiting(reg);

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", async () => {
        // update disponível
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          console.log("[PWA] Update disponível. Tentando ativar…");
          await skipWaiting(reg);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // só recarrega 1 vez
      if (hasReloaded()) return;
      markReloaded();
      console.log("[PWA] SW assumiu controle. Recarregando…");
      window.location.reload();
    });

    // em load novo, limpa flag para permitir updates futuros
    window.addEventListener("pageshow", () => {
      clearReloaded();
    });

    console.log("[PWA] Service Worker registrado");
  } catch (err) {
    console.warn("[PWA] Falha ao registrar Service Worker:", err);
  }
}

if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void registerSW();
  });
}
