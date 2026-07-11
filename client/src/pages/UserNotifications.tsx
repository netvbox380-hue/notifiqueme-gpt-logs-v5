// client/src/pages/UserNotifications.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import MediaViewer from "@/components/MediaViewer";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogContentScrollable,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooterSticky,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  Ban,
  Check,
  LogOut,
  MessageCircle,
  RefreshCcw,
  Settings,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wifi,
} from "lucide-react";
import InstallAppButton from "@/components/InstallAppButton";
import PushActivationBanner from "@/components/PushActivationBanner";
import AnnouncementCard from "@/components/AnnouncementCard";
import { primeNotificationAudio, playNewMessageSound } from "@/lib/notifySound";
import { linkifyText } from "@/lib/linkify";
import {
  loadPushPreferences,
  savePushPreferences,
  setNativeBadge,
  toWhatsAppUrl,
  type PushPreferences,
} from "@/lib/user-notifications";

type PushPrefs = PushPreferences;

type FeedbackKey = "liked" | "disliked" | "renew" | "no_renew" | "problem";

const FEEDBACK_META: Record<
  FeedbackKey,
  { icon: React.ReactNode; label: string }
> = {
  liked: { icon: <ThumbsUp className="w-4 h-4" />, label: "Gostei" },
  disliked: { icon: <ThumbsDown className="w-4 h-4" />, label: "Não gostei" },
  renew: { icon: <RefreshCcw className="w-4 h-4" />, label: "Vou renovar" },
  no_renew: { icon: <Ban className="w-4 h-4" />, label: "Não vou renovar" },
  problem: {
    icon: <AlertTriangle className="w-4 h-4" />,
    label: "Estou tendo problemas",
  },
};

export default function UserNotifications() {
  const utils = trpc.useUtils();
  const { logout } = useAuth();

  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [pageSize, setPageSize] = useState(20);
  const [pushPrefs, setPushPrefs] = useState<PushPrefs>(() =>
    loadPushPreferences(),
  );
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentsNotificationId, setAttachmentsNotificationId] = useState<
    number | null
  >(null);
  const [attachmentsTitle, setAttachmentsTitle] = useState("Anexos");
  const [openingDeliveryId, setOpeningDeliveryId] = useState<number | null>(
    null,
  );
  const [isMediaPlaying, setIsMediaPlaying] = useState(false);
  const [showNewIndicator, setShowNewIndicator] = useState(false);

  const pendingRefreshRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTopIdRef = useRef<number | null>(null);
  // ✅ evita som/vibração em dobro quando o PUSH_PING (tempo real) e o
  // polling de fallback (5s) detectam a mesma mensagem nova quase juntos.
  const lastAlertTsRef = useRef<number>(0);

  const subscription = trpc.tenant.getSubscription.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // ✅ Card informativo persistente e personalizado desse usuário
  const myAnnouncement = trpc.tenant.myAnnouncement.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const attachmentsQuery = trpc.files.listByNotificationId.useQuery(
    { notificationId: attachmentsNotificationId ?? 0 },
    {
      enabled: attachmentsOpen && Boolean(attachmentsNotificationId),
      refetchOnWindowFocus: false,
    },
  );

  const inbox = trpc.notifications.inboxList.useQuery(
    { limit: pageSize, offset: 0 },
    {
      refetchOnWindowFocus: !isMediaPlaying,
      refetchInterval: isMediaPlaying || document.visibilityState !== "visible" ? false : 15_000,
      staleTime: 2000,
    },
  );

  const inboxCountQuery = trpc.notifications.inboxCount.useQuery(undefined, {
    refetchOnWindowFocus: !isMediaPlaying,
    refetchInterval: isMediaPlaying || document.visibilityState !== "visible" ? false : 15_000,
    staleTime: 2000,
  });

  const invalidateInboxNow = useCallback(async () => {
    await Promise.all([
      utils.notifications.inboxList.invalidate(),
      utils.notifications.inboxCount.invalidate(),
    ]);
  }, [utils]);

  const invalidateInbox = useCallback(async () => {
    if (isMediaPlaying) {
      pendingRefreshRef.current = true;
      return;
    }

    await invalidateInboxNow();
  }, [invalidateInboxNow, isMediaPlaying]);

  useEffect(() => {
    if (!isMediaPlaying && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      void invalidateInboxNow();
    }
  }, [isMediaPlaying, invalidateInboxNow]);

  /**
   * ✅ Dispara som + vibração de "nova mensagem".
   * - Protegido contra dedupe: se já alertou nos últimos 2.5s, não repete
   *   (evita som duplicado quando o PUSH_PING em tempo real e o polling de
   *   fallback de 5s detectam a mesma chegada quase juntos).
   * - Som e vibração respeitam as preferências do usuário (pushPrefs).
   */
  const fireMessageAlert = useCallback(() => {
    const now = Date.now();
    if (now - lastAlertTsRef.current < 2500) return;
    lastAlertTsRef.current = now;

    try {
      if (pushPrefs.vibrate && "vibrate" in navigator) {
        // @ts-ignore
        navigator.vibrate?.([50, 25, 50]);
      }
    } catch {}

    if (pushPrefs.sound) {
      void playNewMessageSound();
    }
  }, [pushPrefs]);

  // ✅ "Destrava" o áudio o quanto antes (primeiro toque/clique na tela),
  // assim quando uma notificação chegar de fato, o som já tem chance real
  // de tocar (navegadores bloqueiam áudio antes de qualquer interação).
  useEffect(() => {
    primeNotificationAudio();
  }, []);

  const markAsRead = trpc.notifications.markAsRead.useMutation({
    onSuccess: async (_data, variables) => {
      await invalidateInbox();
      // ✅ Badge nativo: remove da bandeja do Android a notificação já lida,
      // pra que o badge (dot/contador do launcher) fique sempre coerente,
      // em qualquer fabricante — funciona igual no TWA e no WebAPK do Chrome.
      try {
        navigator.serviceWorker?.controller?.postMessage({
          type: "CLOSE_NOTIFICATIONS",
          deliveryIds: [variables?.deliveryId],
        });
      } catch {}
    },
  });

  // ✅ Leitura automática: a mensagem já mostra o conteúdo inteiro no card
  // (não existe "expandir"), então exigir toque manual é redundante.
  // Marcamos como lida quando o card fica visível na tela por um tempo
  // curto (evita marcar algo que só passou rápido durante um scroll).
  const itemsRef = useRef<any[]>([]);

  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;

  const visibilityTimersRef = useRef<
    Map<number, ReturnType<typeof setTimeout>>
  >(new Map());
  const itemNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingAutoReadRef = useRef<Set<number>>(new Set());

  const handleAutoRead = useCallback(async (deliveryId: number) => {
    const target = itemsRef.current.find(
      (it: any) => Number(it?.deliveryId) === deliveryId,
    );
    if (!target || target.isRead) return;
    if (pendingAutoReadRef.current.has(deliveryId)) return;

    pendingAutoReadRef.current.add(deliveryId);
    try {
      await markAsReadRef.current.mutateAsync({ deliveryId });
    } catch {
      // Silencioso: a mensagem permanece "não lida" e será marcada
      // automaticamente na próxima vez que ficar visível na tela.
    } finally {
      pendingAutoReadRef.current.delete(deliveryId);
    }
  }, []);

  const observerRef = useRef<IntersectionObserver | null>(null);
  if (!observerRef.current && typeof IntersectionObserver !== "undefined") {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const deliveryId = Number(
            (entry.target as HTMLElement).dataset.deliveryId || 0,
          );
          if (!deliveryId) return;

          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (visibilityTimersRef.current.has(deliveryId)) return;
            const timer = setTimeout(() => {
              visibilityTimersRef.current.delete(deliveryId);
              void handleAutoRead(deliveryId);
            }, 700);
            visibilityTimersRef.current.set(deliveryId, timer);
          } else {
            const timer = visibilityTimersRef.current.get(deliveryId);
            if (timer) {
              clearTimeout(timer);
              visibilityTimersRef.current.delete(deliveryId);
            }
          }
        });
      },
      { threshold: [0, 0.6, 1] },
    );
  }

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      visibilityTimersRef.current.forEach((timer) => clearTimeout(timer));
      visibilityTimersRef.current.clear();
    };
  }, []);

  const registerMessageNode = useCallback(
    (el: HTMLDivElement | null, deliveryId: number) => {
      const observer = observerRef.current;
      const prevNode = itemNodesRef.current.get(deliveryId);

      if (prevNode && prevNode !== el && observer) {
        observer.unobserve(prevNode);
      }

      if (el) {
        itemNodesRef.current.set(deliveryId, el);
        observer?.observe(el);
      } else {
        itemNodesRef.current.delete(deliveryId);
        const timer = visibilityTimersRef.current.get(deliveryId);
        if (timer) {
          clearTimeout(timer);
          visibilityTimersRef.current.delete(deliveryId);
        }
      }
    },
    [],
  );

  const markAllAsRead = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: async () => {
      await invalidateInbox();
      try {
        navigator.serviceWorker?.controller?.postMessage({
          type: "CLOSE_ALL_NOTIFICATIONS",
        });
      } catch {}
      toast.success("Todas as mensagens foram marcadas como lidas.");
    },
  });

  const setFeedback = trpc.notifications.setFeedback.useMutation({
    onSuccess: async () => {
      await invalidateInbox();
      toast.success("Resposta enviada.");
    },
  });

  const clearAll = trpc.notifications.clearAll.useMutation({
    onSuccess: async () => {
      await invalidateInbox();
      toast("Mensagens apagadas ✅");
    },
    onError: (err: any) => {
      toast(err?.message || "Falha ao apagar mensagens");
    },
  });

  const brandName =
    subscription.data?.branding?.brandName ||
    subscription.data?.name ||
    "Admin";

  const brandLogoUrl = subscription.data?.branding?.brandLogoUrl || "";
  const supportPhone = subscription.data?.branding?.supportPhone || "";
  const supportUrl = toWhatsAppUrl(
    supportPhone,
    "Olá! Preciso de ajuda com as notificações do app.",
  );

  const items = useMemo<any[]>(() => inbox.data?.data ?? [], [inbox.data]);
  itemsRef.current = items;

  const unreadCount =
    inboxCountQuery.data?.count ??
    items.filter((item: any) => !item.isRead).length;

  // 🧭 Snapshot estável da aba "Não lidas": a leitura automática (ou o toque
  // manual) marca a mensagem como lida em segundo plano, mas ela NÃO some
  // da lista no meio da rolagem — isso empurra os itens seguintes e causa
  // aquele efeito de "cascata sumindo" ao rolar rápido. O item continua na
  // lista (só troca o visual de não-lida para lida) até o usuário sair da
  // aba "Não lidas" e voltar, que é o sinal explícito de "quero ver o que
  // está pendente agora".
  const stableUnreadIdsRef = useRef<Set<number>>(new Set());
  const prevFilterRef = useRef<string | null>(null);
  const [stableVersion, setStableVersion] = useState(0);

  // Recalcula o snapshot do zero sempre que o usuário (re)entra na aba "Não lidas".
  useEffect(() => {
    if (filter === "unread" && prevFilterRef.current !== "unread") {
      stableUnreadIdsRef.current = new Set(
        items
          .filter((it: any) => !it.isRead)
          .map((it: any) => Number(it?.deliveryId)),
      );
      setStableVersion((v) => v + 1);
    }
    prevFilterRef.current = filter;
  }, [filter, items]);

  // Mantém o snapshot em dia: adiciona mensagens novas que chegaram não lidas
  // e remove apenas as que deixaram de existir (ex: apagadas) — nunca remove
  // um item só porque ele foi marcado como lido durante a sessão atual.
  useEffect(() => {
    let changed = false;
    const currentIds = new Set(items.map((it: any) => Number(it?.deliveryId)));

    for (const it of items) {
      const id = Number(it?.deliveryId);
      if (!it.isRead && !stableUnreadIdsRef.current.has(id)) {
        stableUnreadIdsRef.current.add(id);
        changed = true;
      }
    }

    for (const id of Array.from(stableUnreadIdsRef.current)) {
      if (!currentIds.has(id)) {
        stableUnreadIdsRef.current.delete(id);
        changed = true;
      }
    }

    if (changed) setStableVersion((v) => v + 1);
  }, [items]);

  const visibleItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item: any) =>
      stableUnreadIdsRef.current.has(Number(item?.deliveryId)),
    );
    // stableVersion força recomputo quando o snapshot muda (ref não é reativo por si só)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, stableVersion]);

  const scrollToTop = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    try {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      el.scrollTop = 0;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowNewIndicator(el.scrollTop >= 120);
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const syncPlayingState = () => {
      const anyPlaying = Array.from(root.querySelectorAll("video")).some(
        (video) => !video.paused && !video.ended && video.readyState > 2,
      );
      setIsMediaPlaying(anyPlaying);
    };

    const handlePlay = () => setIsMediaPlaying(true);
    const handlePauseLike = () => syncPlayingState();

    root.addEventListener("play", handlePlay, true);
    root.addEventListener("playing", handlePlay, true);
    root.addEventListener("pause", handlePauseLike, true);
    root.addEventListener("ended", handlePauseLike, true);
    root.addEventListener("emptied", handlePauseLike, true);

    return () => {
      root.removeEventListener("play", handlePlay, true);
      root.removeEventListener("playing", handlePlay, true);
      root.removeEventListener("pause", handlePauseLike, true);
      root.removeEventListener("ended", handlePauseLike, true);
      root.removeEventListener("emptied", handlePauseLike, true);
    };
  }, []);

  useEffect(() => {
    const top = items?.[0];
    if (!top) return;

    const topId = Number((top as any).deliveryId);

    if (lastTopIdRef.current === null) {
      lastTopIdRef.current = topId;
      scrollToTop();
      return;
    }

    if (topId !== lastTopIdRef.current) {
      if (document.visibilityState !== "visible") {
        lastTopIdRef.current = topId;
        return;
      }
      lastTopIdRef.current = topId;
      toast("Nova mensagem recebida");

      fireMessageAlert();

      if (!showNewIndicator && !isMediaPlaying) {
        scrollToTop();
      }
    }
  }, [
    items,
    pushPrefs,
    showNewIndicator,
    isMediaPlaying,
    scrollToTop,
    fireMessageAlert,
  ]);

  useEffect(() => {
    if (typeof unreadCount !== "number") return;

    if (unreadCount > 0) {
      void setNativeBadge(unreadCount);
    } else {
      void setNativeBadge(0);
    }
  }, [unreadCount]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data: any = event?.data || {};

      if (data?.type === "PUSH_PING") {
        try {
          localStorage.setItem(
            "nm_push_last_ping",
            String(data.ts || Date.now()),
          );
        } catch {}

        // ✅ alerta imediato (som + vibração), na hora real que o push chega —
        // não espera o polling de 5s perceber que a lista mudou.
        if (!data.silent) {
          toast(String(data.title || "Nova mensagem recebida"));
          fireMessageAlert();
        }

        void invalidateInbox();
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [invalidateInbox, fireMessageAlert]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void invalidateInbox();
      }
    };

    const onFocus = () => {
      void invalidateInbox();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [invalidateInbox]);

  useEffect(() => {
    savePushPreferences(pushPrefs);
  }, [pushPrefs]);

  async function handleLogout() {
    try {
      await logout();
    } catch {
    } finally {
      try {
        if ("serviceWorker" in navigator) {
          const registrations =
            await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            registrations.map((registration) => registration.unregister()),
          );
        }
      } catch {}

      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {}

      window.location.href = "/login";
    }
  }

  async function handleOpenNotification(notification: any) {
    const deliveryId = Number(notification.deliveryId);

    if (
      notification.isRead ||
      openingDeliveryId === deliveryId ||
      markAsRead.isPending
    ) {
      return;
    }

    setOpeningDeliveryId(deliveryId);

    try {
      await markAsRead.mutateAsync({ deliveryId });
    } catch {
      toast.error("Não foi possível marcar a mensagem como lida.");
    } finally {
      setOpeningDeliveryId(null);
    }
  }

  if (inbox.isLoading && !items.length) {
    return <div className="p-4">Carregando…</div>;
  }

  return (
    <>
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                (filter === "unread"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background")
              }
            >
              Não lidas
              <span className="min-w-[1.5rem] text-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                {unreadCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("all")}
              className={
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                (filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background")
              }
            >
              Todas
              <span className="min-w-[1.5rem] text-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                {items.length}
              </span>
            </button>

            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => markAllAsRead.mutate()}
                disabled={markAllAsRead.isPending}
              >
                <Check className="w-4 h-4 mr-2" />
                {markAllAsRead.isPending
                  ? "Marcando..."
                  : "Marcar todas como lidas"}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrefsOpen(true)}
              aria-label="Abrir menu"
            >
              <Settings className="w-4 h-4" />
              <span className="ml-2 hidden sm:inline">Menu</span>
            </Button>
          </div>
        </div>

        <PushActivationBanner onAction={() => setPrefsOpen(true)} />
        {myAnnouncement.data?.enabled && myAnnouncement.data?.body ? (
          <AnnouncementCard body={myAnnouncement.data.body} />
        ) : null}

        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/40 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt={brandName}
                  className="h-11 w-11 rounded-xl border object-cover bg-background shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <div className="h-11 w-11 rounded-xl border bg-background shrink-0 flex items-center justify-center text-lg font-bold">
                  {String(brandName || "A")
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {brandName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Toque na mensagem para marcar como lida automaticamente.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-between sm:justify-end">
              <div className="text-xs text-muted-foreground">
                {filter === "unread"
                  ? `${visibleItems.length} não lidas`
                  : `${visibleItems.length} mensagens`}
              </div>

              {supportUrl ? (
                <a
                  href={supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs hover:bg-secondary"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              ) : null}
            </div>
          </div>

          <div
            ref={containerRef}
            className="p-4 sm:p-6 space-y-3 max-h-[70vh] overflow-y-auto"
          >
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhuma mensagem para mostrar agora.
              </div>
            ) : null}

            {visibleItems.map((message: any) => {
              const dt = new Date(message.createdAt);
              const dateStr = dt.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
              const timeStr = dt.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              });

              const when = `${dateStr} às ${timeStr}`;
              const sender = (
                message.senderName ||
                message.senderEmail ||
                message.senderOpenId ||
                brandName ||
                "Admin"
              ).toString();

              const mediaUrl = message.imageUrl
                ? String(message.imageUrl)
                : undefined;

              const currentFeedback = message.feedback
                ? String(message.feedback)
                : "";

              const hasFeedback = Boolean(currentFeedback);

              return (
                <div key={message.deliveryId} className="flex justify-start">
                  <div className="w-full">
                    <div
                      ref={
                        !message.isRead
                          ? (el) =>
                              registerMessageNode(
                                el,
                                Number(message.deliveryId),
                              )
                          : undefined
                      }
                      data-delivery-id={message.deliveryId}
                      className={
                        "w-full rounded-2xl px-4 py-4 border shadow-sm transition cursor-pointer " +
                        (!message.isRead
                          ? "border-red-500/40 bg-zinc-900/70 ring-1 ring-red-500/15"
                          : "border-border bg-card")
                      }
                      onClick={() => void handleOpenNotification(message)}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0 flex items-start gap-3">
                          {brandLogoUrl ? (
                            <img
                              src={brandLogoUrl}
                              alt={brandName}
                              className="h-10 w-10 rounded-full border object-cover bg-background shrink-0"
                              onError={(e) => {
                                (
                                  e.currentTarget as HTMLImageElement
                                ).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full border bg-background shrink-0 flex items-center justify-center text-sm font-bold">
                              {String(brandName || "A")
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="min-w-0 text-xs text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                              {!message.isRead ? (
                                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                              ) : null}

                              <span className="font-medium text-foreground">
                                {sender}
                              </span>

                              {!message.isRead ? (
                                <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">
                                  não lida
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] bg-muted/40">
                                  lida
                                </span>
                              )}
                            </div>

                            <div className="mt-1 text-sm font-semibold break-words">
                              {message.title}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-xs text-muted-foreground">
                          {when}
                        </div>
                      </div>

                      {message.content ? (
                        <div className="text-sm whitespace-pre-wrap break-words">
                          {linkifyText(message.content)}
                        </div>
                      ) : null}

                      {mediaUrl ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenNotification(message);
                          }}
                          className="space-y-2 mt-3"
                        >
                          <MediaViewer url={mediaUrl} title={message.title} />

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAttachmentsTitle(message.title || "Anexos");
                              setAttachmentsNotificationId(
                                Number(message.notificationId),
                              );
                              setAttachmentsOpen(true);
                            }}
                          >
                            Ver anexos
                          </Button>
                        </div>
                      ) : null}

                      <div
                        className="mt-4 flex flex-wrap items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(
                          [
                            "liked",
                            "disliked",
                            "renew",
                            "no_renew",
                            "problem",
                          ] as const
                        ).map((feedbackKey) => {
                          const active = currentFeedback === feedbackKey;

                          return (
                            <button
                              key={feedbackKey}
                              type="button"
                              className={
                                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition " +
                                (active
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background")
                              }
                              disabled={setFeedback.isPending || hasFeedback}
                              onClick={() => {
                                setFeedback.mutate({
                                  deliveryId: Number(message.deliveryId),
                                  feedback: feedbackKey,
                                });
                              }}
                              aria-label={`Marcar como ${feedbackKey}`}
                            >
                              {FEEDBACK_META[feedbackKey].icon}
                              {FEEDBACK_META[feedbackKey].label}
                            </button>
                          );
                        })}
                      </div>

                      {hasFeedback ? (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                          <Check className="w-3.5 h-3.5" />
                          Resposta enviada:{" "}
                          {FEEDBACK_META[currentFeedback as FeedbackKey]
                            ?.label || currentFeedback}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{when}</span>

                        {supportUrl ? (
                          <a
                            href={supportUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Falar no WhatsApp
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {items.length >= pageSize ? (
              <div className="pt-2 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPageSize((value) => value + 20)}
                >
                  Carregar mais mensagens
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {showNewIndicator ? (
          <button
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 bg-primary text-white px-4 py-2 rounded-full shadow-lg"
          >
            Novas mensagens ↓
          </button>
        ) : null}
      </div>

      <Dialog open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{attachmentsTitle}</DialogTitle>
          </DialogHeader>

          {attachmentsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">
              Carregando anexos...
            </div>
          ) : attachmentsQuery.data?.success &&
            (attachmentsQuery.data as any).data?.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(attachmentsQuery.data as any).data.map((file: any) => (
                <div key={file.id} className="rounded-xl border p-2">
                  <MediaViewer
                    url={String(file.fileKey || file.url)}
                    title={file.filename || attachmentsTitle}
                  />
                  <div className="mt-2 text-xs text-muted-foreground break-all">
                    {file.filename}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Nenhum anexo encontrado.
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContentScrollable className="max-w-md p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/60">
            <DialogTitle>Menu</DialogTitle>
          </DialogHeader>

          <DialogBody className="px-4 py-4">
            <div className="space-y-4">
              <div className="rounded-xl border p-3 space-y-2">
                <div className="text-sm font-medium">
                  Notificações e instalação
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  Ative o push e instale o app (PWA) para não ficar
                  desconectando.
                </div>
                <InstallAppButton />
              </div>

              <div className="rounded-xl border p-3 space-y-2">
                <div className="text-sm font-medium">Canal da empresa</div>
                <div className="text-xs text-muted-foreground">
                  Logo e WhatsApp agora ficam integrados à inbox do usuário
                  final.
                </div>

                <div className="flex items-center gap-3">
                  {brandLogoUrl ? (
                    <img
                      src={brandLogoUrl}
                      alt={brandName}
                      className="h-12 w-12 rounded-xl border object-cover bg-background"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  ) : null}

                  <div className="min-w-0">
                    <div className="font-medium truncate">{brandName}</div>

                    {supportUrl ? (
                      <a
                        href={supportUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-emerald-400 hover:underline"
                      >
                        {supportPhone || "WhatsApp"}
                      </a>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Sem WhatsApp cadastrado.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">
                      Som ao receber mensagem
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Apenas quando o app está aberto
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={pushPrefs.sound}
                    onChange={(e) =>
                      setPushPrefs((prev) => ({
                        ...prev,
                        sound: e.target.checked,
                      }))
                    }
                  />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div>
                    <div className="text-sm font-medium">Vibração</div>
                    <div className="text-xs text-muted-foreground">
                      App aberto e (quando possível) no push
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={pushPrefs.vibrate}
                    onChange={(e) =>
                      setPushPrefs((prev) => ({
                        ...prev,
                        vibrate: e.target.checked,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="rounded-xl border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wifi className="w-4 h-4" />
                  Monitor de push
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  {(() => {
                    try {
                      const ts = Number(
                        localStorage.getItem("nm_push_last_ping") || 0,
                      );

                      if (!ts) {
                        return "Ainda não recebemos nenhum push nesta instalação.";
                      }

                      const date = new Date(ts);
                      return `Último ping: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                    } catch {
                      return "Monitor indisponível.";
                    }
                  })()}
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium">Mensagens</div>

                <div className="mt-2 space-y-2">
                  {unreadCount > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => markAllAsRead.mutate()}
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Marcar todas como lidas
                    </Button>
                  ) : null}

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        disabled={clearAll.isPending}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {clearAll.isPending
                          ? "Apagando…"
                          : "Apagar todas as mensagens"}
                      </Button>
                    </AlertDialogTrigger>

                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Apagar todas as mensagens?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação é permanente e não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>

                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await clearAll.mutateAsync();
                          }}
                        >
                          Apagar tudo
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </DialogBody>

          <DialogFooterSticky className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-9 text-xs font-medium"
              onClick={() => {
                setPrefsOpen(false);
                void handleLogout();
              }}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </DialogFooterSticky>
        </DialogContentScrollable>
      </Dialog>
    </>
  );
}
