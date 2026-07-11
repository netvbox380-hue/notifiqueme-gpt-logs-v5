import React, { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Bell,
  Calendar,
  Clock,
  FileText,
  LogOut,
  Users,
  UsersRound,
  LayoutDashboard,
  ShieldCheck,
  ShieldAlert,
  Crown,
  Phone,
  ExternalLink,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { toast } from "sonner";
import InstallAppButton from "@/components/InstallAppButton";
import { trpc } from "@/lib/trpc";

import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

type NavItem = {
  path: string;
  icon: any;
  label: string;
  ownerOnly?: boolean;
};

function RoleBadge({ isOwner, isAdmin, isReseller }: { isOwner: boolean; isAdmin: boolean; isReseller: boolean }) {
  if (isOwner) {
    return (
      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 text-xs bg-primary text-primary-foreground font-bold">
        <Crown className="w-3 h-3" /> OWNER
      </span>
    );
  }
  if (isReseller) {
    return (
      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 text-xs bg-muted text-muted-foreground font-bold border border-border">
        <ShieldCheck className="w-3 h-3" /> REVENDA
      </span>
    );
  }
  if (isAdmin) {
    return (
      <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-secondary text-secondary-foreground font-bold border border-border">
        ADMIN
      </span>
    );
  }
  return (
    <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-muted text-muted-foreground font-bold">
      USER
    </span>
  );
}

function SidebarNav({
  navItems,
  location,
}: {
  navItems: NavItem[];
  location: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu className="p-2">
      {navItems.map((item) => {
        const isActive = location === item.path;
        const Icon = item.icon;

        return (
          <SidebarMenuItem key={item.path}>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
              className={[
                "h-11 border-2 border-transparent",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary"
                  : "hover:border-sidebar-border hover:bg-sidebar-accent text-sidebar-foreground",
                item.ownerOnly ? "font-semibold text-primary" : "",
              ].join(" ")}
            >
              <Link href={item.path}>
                <a className="flex items-center gap-3">
                  <Icon
                    className={[
                      "w-5 h-5",
                      item.ownerOnly ? "text-primary" : "",
                    ].join(" ")}
                  />
                  <span className="font-medium">{item.label}</span>
                  {item.ownerOnly ? (
                    <Crown className="w-3 h-3 ml-auto text-primary" />
                  ) : null}
                </a>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

/* ============================
   ✅ Badge helpers (safe)
============================ */
async function setBadgeCount(count: number) {
  const n = Number(count) || 0;

  // window badge (quando suportado)
  try {
    // @ts-ignore
    if ("setAppBadge" in navigator) {
      // @ts-ignore
      await navigator.setAppBadge(n);
    }
  } catch {}

  // manda pro SW também (cobre instalado/controle)
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SET_BADGE", count: n });
    }
  } catch {}
}

async function clearBadgeCount() {
  try {
    // @ts-ignore
    if ("clearAppBadge" in navigator) {
      // @ts-ignore
      await navigator.clearAppBadge();
    }
  } catch {}

  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_BADGE" });
    }
  } catch {}
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { logout, userData, isOwner, isAdmin, isReseller } = useAuth();
  const [location, setLocation] = useLocation();
  const { data: subscription } = trpc.tenant.getSubscription.useQuery(undefined, {
    enabled: Boolean(userData),
    refetchOnWindowFocus: false,
  });
  const brandName = subscription?.branding?.brandName || (isOwner ? "NOTIFIQUE-ME" : subscription?.name || "NOTIFIQUE-ME");
  const brandLogoUrl = subscription?.branding?.brandLogoUrl || "";
  const brandPrimaryColor = subscription?.branding?.brandPrimaryColor || "";
  const supportPhone = subscription?.branding?.supportPhone || "";

  const brandBarStyle = brandPrimaryColor ? ({ backgroundColor: brandPrimaryColor } as React.CSSProperties) : undefined;

  /**
   * ✅ Inbox count -> Badge do app instalado
   * - Mantém contador sincronizado sem polling pesado.
   * - Se backend já atualiza em push, isso garante correção ao abrir o app.
   */
  const inboxCountQuery = trpc.notifications.inboxCount.useQuery(undefined, {
    enabled: Boolean(userData), // só quando logado
    refetchOnWindowFocus: true,
    refetchInterval: 30_000, // leve (30s). push atualiza "na hora"; isso é só correção/fallback
    staleTime: 10_000,
  });

  useEffect(() => {
    const count = inboxCountQuery.data?.count;

    // quando query ainda não tem valor, não mexe
    if (typeof count !== "number") return;

    if (count > 0) {
      void setBadgeCount(count);
    } else {
      void clearBadgeCount();
    }
  }, [inboxCountQuery.data?.count]);

  /**
   * ✅ Admin: se tiver mensagens não lidas, direciona para a área de usuário comum.
   * - Funciona mesmo quando o admin já está logado e abre direto uma rota /dashboard.
   * - Evita loop com uma flag em sessionStorage.
   */
  useEffect(() => {
    if (!isAdmin || isOwner) return;
    const count = inboxCountQuery.data?.count;
    if (typeof count !== "number") return;
    if (location === "/my-notifications") return;
    if (count <= 0) {
      try {
        sessionStorage.removeItem("nm_admin_inbox_redirected");
      } catch {}
      return;
    }

    let already = false;
    try {
      already = sessionStorage.getItem("nm_admin_inbox_redirected") === "1";
    } catch {}

    if (already) return;
    try {
      sessionStorage.setItem("nm_admin_inbox_redirected", "1");
    } catch {}
    setLocation("/my-notifications");
  }, [isAdmin, isOwner, inboxCountQuery.data?.count, location, setLocation]);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Logout realizado com sucesso");

      // ✅ limpa badge ao sair
      void clearBadgeCount();

      window.location.href = "/login";
    } catch {
      toast.error("Erro ao fazer logout");
    }
  };

  const baseNavItems: NavItem[] = [
    { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/users", icon: Users, label: "Usuários" },
    { path: "/groups", icon: UsersRound, label: "Grupos" },
    { path: "/notifications", icon: Bell, label: "Notificações" },
    { path: "/schedule", icon: Calendar, label: "Agendamentos" },
    { path: "/history", icon: Clock, label: "Histórico" },
    { path: "/logs", icon: FileText, label: "Logs" },
    { path: "/subscription", icon: ShieldCheck, label: "Plano & Cobrança" },
  ];

  const ownerNavItems: NavItem[] = [
    { path: "/superadmin", icon: ShieldAlert, label: "Área do Dono", ownerOnly: true },
  ];

  const resellerNavItems: NavItem[] = [
    { path: "/superadmin", icon: ShieldAlert, label: "Área da Revenda" },
    { path: "/users", icon: Users, label: "Admins dos Clientes" },
  ];

  const navItems = isOwner ? [...baseNavItems, ...ownerNavItems] : isReseller ? resellerNavItems : baseNavItems;

  return (
    <>
      <SidebarProvider defaultOpen={true} className="w-full">
      <Sidebar className="bg-sidebar border-sidebar-border h-dvh md:h-auto">
        <SidebarHeader className="border-b-2 border-sidebar-border p-4">
          <div className="px-2 py-2">
            {brandPrimaryColor ? <div className="mb-3 h-1.5 w-20 rounded-sm" style={brandBarStyle} /> : null}
            <div className="flex items-center gap-3">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt={brandName}
                  className="h-12 w-12 rounded-md border-2 border-border object-cover bg-background"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <img
                  src="/icon-512.png"
                  alt={brandName}
                  className="h-12 w-12 rounded-md border-2 border-border object-cover bg-background"
                />
              )}
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-sidebar-foreground mono" style={brandPrimaryColor ? ({ color: brandPrimaryColor } as React.CSSProperties) : undefined}>
                  {brandName}
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {isOwner ? "Super Admin Panel" : isReseller ? "Reseller Panel" : "Admin Panel"}
                </p>
              </div>
            </div>
            <RoleBadge isOwner={isOwner} isAdmin={isAdmin} isReseller={isReseller} />
          </div>
        </SidebarHeader>

        <SidebarContent className="min-h-0 flex-1 overflow-y-auto p-2">
          <SidebarNav navItems={navItems} location={location} />
        </SidebarContent>

        <SidebarFooter className="shrink-0 border-t-2 border-sidebar-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 px-2">
            <p className="text-sm font-medium text-sidebar-foreground mono">
              {userData?.name || "Usuário"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {userData?.email || ""}
            </p>
            <p className="text-xs text-primary font-bold uppercase mt-1">
              {userData?.role || "user"}
            </p>
          </div>

          {supportPhone ? (
            <div className="mb-3 space-y-2 rounded-md border-2 border-border p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Suporte</div>
              <a
                href={`https://wa.me/${supportPhone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm font-medium hover:text-primary"
              >
                <Phone className="h-4 w-4" />
                <span className="truncate">{supportPhone}</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            </div>
          ) : null}

          <div className="mb-3">
            <InstallAppButton />
          </div>

          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full justify-start gap-3 border-2 border-sidebar-border hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-screen w-full overflow-x-hidden">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/80 backdrop-blur p-3 md:hidden">
          <SidebarTrigger />
          <div className="flex flex-1 items-center gap-2">
            {brandLogoUrl ? (
              <img
                src={brandLogoUrl}
                alt={brandName}
                className="h-8 w-8 rounded-md border border-border object-cover bg-background"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <img
                src="/icon-512.png"
                alt={brandName}
                className="h-8 w-8 rounded-md border border-border object-cover bg-background"
              />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-bold" style={brandPrimaryColor ? ({ color: brandPrimaryColor } as React.CSSProperties) : undefined}>{brandName}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {userData?.email || ""}
              </div>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="sm"
            className="border-2 border-border"
          >
            Sair
          </Button>
        </div>

        <main className="w-full flex-1 overflow-x-hidden p-3 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
    </>
  );
}
