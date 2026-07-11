import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./contexts/AuthContext";

import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import AccountDeletion from "./pages/AccountDeletion";
import DailyTip from "./pages/DailyTip";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Groups from "./pages/Groups";
import Notifications from "./pages/Notifications";
import Schedule from "./pages/Schedule";
import History from "./pages/History";
import Logs from "./pages/Logs";
import UserNotifications from "./pages/UserNotifications";
import Subscription from "./pages/Subscription";
import SuperAdmin from "./pages/SuperAdmin";

// 🔥 NOVO
import AdminNotifications from "./pages/AdminNotifications";
import { useEffect } from "react";
import { toast } from "sonner";
import { refreshPushStatus } from "@/lib/push";

function ProtectedRoute({
  component: Component,
  requireOwner = false,
  requireAdmin = false,
  requireUser = false,
}: {
  component: React.ComponentType;
  requireOwner?: boolean;
  requireAdmin?: boolean;
  requireUser?: boolean;
}) {
  const { loading, isAuthenticated, userData, isOwner, isAdmin, isUser, isReseller } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!isAuthenticated || !userData) {
    return <Redirect to="/login" />;
  }

  if (requireOwner && !isOwner) return <Redirect to="/dashboard" />;
  if (requireAdmin && !isAdmin) return <Redirect to="/my-notifications" />;
  if (requireUser && !(isUser || isAdmin)) return <Redirect to={isOwner || isReseller ? "/superadmin" : "/dashboard"} />;

  return <Component />;
}

export default function App() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // ✅ DEV (netlify dev / vite): NÃO usar Service Worker
    // Motivo: em ambientes http + proxy (ex: 192.168.x.x:8888) o SW pode cair no fallback offline ao instalar.
    // Em produção (https), o SW é registrado normalmente.
    const host = String(window.location.hostname || "");
    const isDevHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local");
    const isDev = Boolean((import.meta as any)?.env?.DEV) || isDevHost;

    if (isDev) {
      // Limpeza best-effort: remove SW antigos e caches para evitar "offline" preso no domínio.
      (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        } catch {}
        try {
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {}
      })();
      return;
    }

    // ✅ PRODUÇÃO: garante SW do app (compatível com Android e iOS PWA)
    navigator.serviceWorker
      .getRegistration("/")
      .then(async (reg) => {
        const registration = reg || await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        try { await registration.update(); } catch {}
        refreshPushStatus();
        return registration;
      })
      .catch(() => null);

    const onMessage = (event: MessageEvent) => {
      const data: any = (event as any)?.data || {};
      if (!data?.type) return;

      if (data.type === "PUSH_PING") {
        // badge (best-effort)
        const count = Number(data.badgeCount || 0) || 0;
        try {
          if ("setAppBadge" in navigator && typeof (navigator as any).setAppBadge === "function") {
            (navigator as any).setAppBadge(count);
          } else if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "SET_BADGE", count });
          }
        } catch {}

        // toast interno (somente quando app está aberto/visível)
        try {
          if (!data.silent && typeof document !== "undefined" && document.visibilityState === "visible") {
            const t = String(data.title || "Nova mensagem");
            const b = String(data.body || "");
            toast(t, b ? { description: b } : undefined);
          }
        } catch {}
      }

      if (data.type === "NAVIGATE" && data.url) {
        // SPA pode lidar, mas aqui garantimos navegação mesmo se não houver handler
        try {
          if (window.location.pathname !== data.url) window.location.href = data.url;
        } catch {}
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage as any);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage as any);
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/account-deletion" component={AccountDeletion} />
            <Route path="/dica-do-dia" component={DailyTip} />

            {/* USER */}
            <Route
              path="/my-notifications"
              component={() => <ProtectedRoute component={UserNotifications} requireUser />}
            />

            {/* ADMIN */}
            <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} requireAdmin />} />
            <Route path="/users" component={() => <ProtectedRoute component={Users} requireAdmin />} />
            <Route path="/groups" component={() => <ProtectedRoute component={Groups} requireAdmin />} />

            {/* ✅ FIX: Notificações agora abre o painel com Enviar */}
            <Route
              path="/notifications"
              component={() => <ProtectedRoute component={AdminNotifications} requireAdmin />}
            />

            {/* (opcional) manter o atalho antigo do painel avançado */}
            <Route
              path="/admin-messages"
              component={() => <ProtectedRoute component={AdminNotifications} requireAdmin />}
            />

            <Route path="/schedule" component={() => <ProtectedRoute component={Schedule} requireAdmin />} />
            <Route path="/history" component={() => <ProtectedRoute component={History} requireAdmin />} />
            <Route path="/logs" component={() => <ProtectedRoute component={Logs} requireAdmin />} />

            <Route
              path="/subscription"
              component={() => <ProtectedRoute component={Subscription} requireAdmin />}
            />

            {/* OWNER */}
            <Route path="/superadmin" component={() => <ProtectedRoute component={SuperAdmin} requireAdmin />} />

            <Route path="/" component={() => <Redirect to="/login" />} />
            <Route component={NotFound} />
          </Switch>

          <Toaster richColors />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
