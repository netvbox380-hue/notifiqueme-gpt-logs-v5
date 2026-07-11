// client/src/pages/Notifications.tsx
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContentScrollable,
  DialogFooterSticky,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmDanger } from "@/components/ui/confirm-danger";
import { Input } from "@/components/ui/input";
import MediaViewer from "@/components/MediaViewer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { FileUploader } from "@/components/FileUploader";
import { trpc } from "@/lib/trpc";
import { ChevronLeft, Search, Send, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const FEEDBACK_META: Record<string, { label: string; icon: string }> = {
  liked: { label: "Gostei", icon: "👍" },
  disliked: { label: "Não gostei", icon: "👎" },
  renew: { label: "Vou renovar", icon: "🔁" },
  no_renew: { label: "Não vou renovar", icon: "⛔" },
  problem: { label: "Tive problema", icon: "⚠️" },
};

function asArray<T = any>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as T[];
  if (typeof val === "object" && Array.isArray((val as any).data))
    return (val as any).data as T[];
  return [];
}

function formatDateTimeBR(v?: string | Date | null) {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function threadColor(t: { type: "user" | "group" | "campaign" }) {
  if (t.type === "campaign") return "border-l-4 border-l-emerald-500";
  if (t.type === "group") return "border-l-4 border-l-sky-500";
  return "border-l-4 border-l-violet-500";
}

function threadAvatarBg(t: { type: "user" | "group" | "campaign" }) {
  if (t.type === "campaign") return "bg-emerald-500/15 text-emerald-300";
  if (t.type === "group") return "bg-sky-500/15 text-sky-300";
  return "bg-violet-500/15 text-violet-300";
}

function initialsFromTitle(s: string) {
  const cleaned = String(s || "").trim();
  if (!cleaned) return "•";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "").toUpperCase();
  const b = (parts[1]?.[0] || "").toUpperCase();
  return (a + b) || a || "•";
}

export default function Notifications() {
  const { isOwner, userData } = useAuth();
  const utils = trpc.useUtils();

  const [ownerTenantId, setOwnerTenantId] = useState<string>("");
  const tenantsQuery = trpc.superadmin.listTenants.useQuery(undefined, {
    enabled: isOwner,
  });

  React.useEffect(() => {
    if (
      isOwner &&
      !ownerTenantId &&
      Array.isArray(tenantsQuery.data) &&
      tenantsQuery.data.length
    ) {
      setOwnerTenantId(String((tenantsQuery.data as any[])[0].id));
    }
  }, [isOwner, ownerTenantId, tenantsQuery.data]);

  const tenantIdNum = isOwner ? (ownerTenantId ? Number(ownerTenantId) : null) : null;
  const ownerHasTenant = !isOwner || Boolean(tenantIdNum);

  // lista (enviadas)
  const listQuery = trpc.notifications.list.useQuery(
    {
      limit: 100,
      offset: 0,
      tenantId: isOwner ? (tenantIdNum ?? null) : null,
    },
    {
      enabled: Boolean(userData) && ownerHasTenant,
      refetchOnWindowFocus: false,
    }
  );

  const notificationIds = useMemo(
    () =>
      asArray<any>(listQuery.data?.data)
        .map((n: any) => Number(n.id))
        .filter((n) => Number.isFinite(n)),
    [listQuery.data?.data]
  );

  const feedbackSummaryQuery = trpc.notifications.feedbackSummary.useQuery(
    { notificationIds },
    {
      enabled: notificationIds.length > 0,
      refetchInterval: 4000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
    }
  );

  const feedbackById = feedbackSummaryQuery.data?.byId || {};

  // ✅ Botão "Enviar mensagem"
  const [open, setOpen] = useState(false);

  // ✅ Limpeza de mensagens (apagar enviadas)
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupMode, setCleanupMode] = useState<
    "all" | "range" | "older_than_days"
  >("all");
  const [cleanupFrom, setCleanupFrom] = useState("");
  const [cleanupTo, setCleanupTo] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);

  // ✅ UI moderna: busca + expandir detalhes
  const [searchTerm, setSearchTerm] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState<"list" | "detail">("list");
  const [isMobile, setIsMobile] = useState(false);

  const purgeSent = trpc.notifications.purgeSent.useMutation({
    onSuccess: async () => {
      toast("Limpeza executada");
      await utils.notifications.list.invalidate();
      setCleanupOpen(false);
    },
    onError: (err) => toast(err.message || "Falha ao limpar"),
  });

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState<"all" | "users" | "groups">("all");
  const [targetIds, setTargetIds] = useState<number[]>([]);

  type AttachmentItem = { fileId: number; fileKey?: string; url: string };
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  // ✅ targets: admin (tenant) OU owner (seleciona tenant)
  const usersQueryOwner = trpc.superadmin.listAdmins.useQuery(undefined, {
    enabled: isOwner && open && ownerHasTenant && targetType === "users",
  });

  const usersQueryTenant = trpc.tenant.listMyUsers.useQuery(undefined, {
    enabled: !isOwner && open && targetType === "users",
  });

  const usersQuery = isOwner ? usersQueryOwner : usersQueryTenant;

  const groupsQueryOwner = trpc.superadmin.listGroupsByTenant.useQuery(
    { tenantId: tenantIdNum ?? 0 },
    { enabled: isOwner && open && ownerHasTenant && targetType === "groups" }
  );

  const groupsQueryTenant = trpc.groups.list.useQuery(
    { limit: 200 },
    { enabled: !isOwner && open && targetType === "groups" }
  );

  const groupsQuery = isOwner ? groupsQueryOwner : groupsQueryTenant;

  const usersQuickQueryOwner = trpc.superadmin.listAdmins.useQuery(undefined, {
    enabled: isOwner && ownerHasTenant,
  });

  const usersQuickQueryTenant = trpc.tenant.listMyUsers.useQuery(undefined, {
    enabled: !isOwner,
  });

  const quickUsersQuery = isOwner ? usersQuickQueryOwner : usersQuickQueryTenant;

  const groupsQuickQueryOwner = trpc.superadmin.listGroupsByTenant.useQuery(
    { tenantId: tenantIdNum ?? 0 },
    { enabled: isOwner && ownerHasTenant }
  );

  const groupsQuickQueryTenant = trpc.groups.list.useQuery(
    { limit: 200 },
    { enabled: !isOwner }
  );

  const quickGroupsQuery = isOwner ? groupsQuickQueryOwner : groupsQuickQueryTenant;

  const availableTargets = useMemo(() => {
    if (targetType === "users") {
      const arr = asArray<any>(usersQuery.data);
      if (!isOwner) return arr;
      return tenantIdNum ? arr.filter((u: any) => Number(u.tenantId) === Number(tenantIdNum)) : arr;
    }
    if (targetType === "groups") return asArray<any>(groupsQuery.data?.data);
    return [];
  }, [targetType, usersQuery.data, groupsQuery.data, isOwner, tenantIdNum]);

  const send = trpc.notifications.send.useMutation({
    onSuccess: async (_res: any) => {
      toast.success("Mensagem enviada");
      setOpen(false);
      setTitle("");
      setContent("");
      setTargetType("all");
      setTargetIds([]);
      setAttachments([]);
      await utils.notifications.list.invalidate();
    },
    onError: (err) => {
      toast(err.message || "Falha ao enviar");
    },
  });

  function toggleId(id: number) {
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function canSend() {
    if (!title.trim() || !content.trim()) return false;
    if (targetType === "all") return true;
    return targetIds.length > 0;
  }

  function handleSend() {
    if (!canSend()) {
      toast(targetType === "all" ? "Preencha título e mensagem" : "Selecione pelo menos um destino");
      return;
    }

    const targetLabel =
      targetType === "all"
        ? "Todos"
        : `${targetIds.length} ${targetType === "groups" ? "grupo(s)" : isOwner ? "admin(s)" : "usuário(s)"}`;

    const ok = window.confirm(`Enviar esta mensagem para: ${targetLabel}?`);
    if (!ok) return;

    send.mutate({
      tenantId: isOwner ? (tenantIdNum ?? undefined) : undefined,
      title: title.trim(),
      content: content.trim(),
      targetType,
      targetIds: targetType === "all" ? [] : targetIds,
      imageUrl: attachments[0]?.fileKey || attachments[0]?.url || undefined,
      attachmentFileKeys: attachments.map((a) => a.fileKey).filter((k): k is string => Boolean(k)),
    });
  }

  const filteredAvailableTargets = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return availableTargets;
    return availableTargets.filter((t: any) => {
      const hay = [t?.name, t?.loginId, t?.email, t?.openId, t?.description, String(t?.id ?? "")].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [availableTargets, targetSearch]);

  const quickDestinationMatches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];

    const matches: Array<any> = [];
    const addUnique = (item: any) => {
      if (!matches.some((m) => m.key === item.key)) matches.push(item);
    };

    for (const u of asArray<any>(quickUsersQuery.data)) {
      const hay = [u?.name, u?.loginId, u?.email, u?.openId, String(u?.id ?? "")].join(" ").toLowerCase();
      if (hay.includes(q)) {
        addUnique({
          key: `user:${u.id}`,
          id: Number(u.id),
          type: "users",
          title: u?.name || u?.loginId || u?.openId || `Usuário #${u.id}`,
          subtitle: u?.email || u?.openId || null,
        });
      }
    }

    if (!isOwner) {
      for (const g of asArray<any>(quickGroupsQuery.data?.data ?? quickGroupsQuery.data)) {
        const hay = [g?.name, g?.description, String(g?.id ?? "")].join(" ").toLowerCase();
        if (hay.includes(q)) {
          addUnique({
            key: `group:${g.id}`,
            id: Number(g.id),
            type: "groups",
            title: g?.name || `Grupo #${g.id}`,
            subtitle: g?.description || null,
          });
        }
      }
    }

    return matches.slice(0, 8);
  }, [searchTerm, quickUsersQuery.data, quickGroupsQuery.data, isOwner]);

  function openQuickConversation(match: { id: number; type: "users" | "groups" }) {
    setTargetType(match.type);
    setTargetIds([match.id]);
    setTargetSearch("");
    setOpen(true);
  }

  const rawList = asArray<any>(listQuery.data?.data);

  const filteredList = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rawList;
    return rawList.filter((n: any) => {
      const single = n?.singleRecipient;
      const recipientName = single?.name || single?.loginId || single?.email || single?.openId || "";
      const hay = [n?.title, n?.content, recipientName].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rawList, searchTerm]);

  type ThreadType = "user" | "group" | "campaign";
  type Thread = {
    key: string;
    type: ThreadType;
    title: string;
    subtitle?: string;
    lastTitle?: string;
    lastBody?: string;
    lastAt?: string;
    delivered: number;
    read: number;
    failed: number;
    images: number;
    videos: number;
    files: number;
    items: any[];
  };

  const threads = useMemo<Thread[]>(() => {
    const byKey = new Map<string, Thread>();

    const getCounts = (n: any) => {
      // ✅ compat: backend atual expõe "attachments" (files relacionados)
      // Mantém fallback para "media" em bases antigas.
      const media = asArray<any>(n.attachments ?? n.media);
      const images = media.filter((m) => (m?.mimeType || m?.mime || "").startsWith("image/")).length;
      const videos = media.filter((m) => (m?.mimeType || m?.mime || "").startsWith("video/")).length;
      const files = Math.max(0, media.length - images - videos);
      return { images, videos, files };
    };

    const getThreadMeta = (n: any): { key: string; type: ThreadType; title: string; subtitle?: string } => {
      // ✅ compat: backend atual expõe "singleRecipient" (em vez de singleUser)
      if (n?.singleRecipient?.id) {
        const name = (n.singleRecipient.name || n.singleRecipient.openId || "").trim();
        return {
          key: `user:${n.singleRecipient.id}`,
          type: "user",
          title: name || `Usuário #${n.singleRecipient.id}`,
        };
      }

      const groupNames = asArray<string>(n?.groupNames);
      const targetIds = asArray<any>(n?.targetIds);

      if (groupNames.length === 1 && targetIds.length === 1) {
        return { key: `group:${targetIds[0]}`, type: "group", title: groupNames[0] || `Grupo #${targetIds[0]}` };
      }

      if (groupNames.length >= 2) {
        const subtitle =
          groupNames.slice(0, 3).join(", ") + (groupNames.length > 3 ? ` +${groupNames.length - 3}` : "");
        return { key: `campaign:${n.id}`, type: "campaign", title: `Campanha (${groupNames.length} grupos)`, subtitle };
      }

      return {
        key: `campaign:${n.id}`,
        type: "campaign",
        title: n?.recipientLabel || "users",
        subtitle: n?.targetType ? String(n.targetType) : undefined,
      };
    };

    const sorted = [...filteredList].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    for (const n of sorted) {
      const meta = getThreadMeta(n);
      const counts = getCounts(n);
      const existing = byKey.get(meta.key);

      if (!existing) {
        byKey.set(meta.key, {
          key: meta.key,
          type: meta.type,
          title: meta.title,
          subtitle: meta.subtitle,
          lastTitle: n.title,
          lastBody: n.content,
          lastAt: n.createdAt,
          delivered: n.delivered ?? 0,
          read: n.read ?? 0,
          failed: n.failed ?? 0,
          images: counts.images,
          videos: counts.videos,
          files: counts.files,
          items: [n],
        });
      } else {
        existing.items.push(n);

        if (new Date(n.createdAt).getTime() > new Date(existing.lastAt || 0).getTime()) {
          existing.lastTitle = n.title;
          existing.lastBody = n.content;
          existing.lastAt = n.createdAt;
        }

        existing.delivered = n.delivered ?? existing.delivered;
        existing.read = n.read ?? existing.read;
        existing.failed = n.failed ?? existing.failed;

        existing.images += counts.images;
        existing.videos += counts.videos;
        existing.files += counts.files;
      }
    }

    return Array.from(byKey.values()).sort(
      (a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()
    );
  }, [filteredList]);

  const selectedThread = useMemo<Thread | null>(() => {
    if (!threads.length) return null;
    const found = selectedThreadKey ? threads.find((t) => t.key === selectedThreadKey) : null;
    return found || threads[0];
  }, [threads, selectedThreadKey]);

  const selectedNotificationIds = useMemo(() => {
    const ids = asArray<any>(selectedThread?.items)
      .map((n: any) => Number(n.id))
      .filter((n) => Number.isFinite(n));
    return Array.from(new Set(ids)).slice(0, 200);
  }, [selectedThread?.items]);

  const selectedPrimaryNotificationId = useMemo(() => {
    const sorted = [...asArray<any>(selectedThread?.items)].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted.length ? Number(sorted[0].id) : 0;
  }, [selectedThread?.items]);

  const deliveryMapQuery = trpc.notifications.deliveryMap.useQuery(
    { notificationId: selectedPrimaryNotificationId },
    { enabled: selectedPrimaryNotificationId > 0, refetchInterval: 4000, refetchOnWindowFocus: true }
  );

  const feedbackRespondersQuery = trpc.notifications.feedbackResponders.useQuery(
    { notificationIds: selectedNotificationIds, limitPerNotification: 50 },
    {
      enabled: selectedNotificationIds.length > 0,
      refetchInterval: 4000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
    }
  );

  const respondersById = feedbackRespondersQuery.data?.byId || {};

  useEffect(() => {
    if (!threads.length) {
      if (selectedThreadKey !== null) setSelectedThreadKey(null);
      return;
    }
    if (!selectedThreadKey) setSelectedThreadKey(threads[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length]);

  useEffect(() => {
    const sync = () => setIsMobile(window.matchMedia("(max-width: 767px)").matches);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileMode("detail");
      return;
    }
    if (!selectedThreadKey) setMobileMode("list");
  }, [isMobile, selectedThreadKey]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-8 space-y-4">
        {/* top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex-1 space-y-2">
            <Input
              placeholder="Buscar por título, conteúdo ou destinatário..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xl"
            />

            {searchTerm.trim() && quickDestinationMatches.length > 0 ? (
              <div className="max-w-xl rounded-xl border bg-card p-2">
                <div className="px-2 pb-1 text-xs text-muted-foreground">
                  Destinos encontrados para iniciar nova conversa
                </div>
                <div className="space-y-1">
                  {quickDestinationMatches.map((match) => (
                    <button
                      key={match.key}
                      type="button"
                      onClick={() => openQuickConversation(match)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{match.title}</div>
                        {match.subtitle ? (
                          <div className="truncate text-xs text-muted-foreground">{match.subtitle}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {match.type === "groups" ? "grupo" : isOwner ? "admin" : "usuário"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            {isOwner ? (
              <div className="min-w-[220px]">
                <Select value={ownerTenantId} onValueChange={setOwnerTenantId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {asArray<any>(tenantsQuery.data).map((t: any) => (
                      <SelectItem key={String(t.id)} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* cleanup */}
            <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Trash2 className="w-4 h-4" />
                  Apagar enviadas
                </Button>
              </DialogTrigger>

              <DialogContentScrollable className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Apagar mensagens enviadas</DialogTitle>
                </DialogHeader>

                <DialogBody className="space-y-3">
                  <Select value={cleanupMode} onValueChange={(v: any) => setCleanupMode(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">🗑 Apagar todas</SelectItem>
                      <SelectItem value="range">🗓 Apagar por período</SelectItem>
                      <SelectItem value="older_than_days">🔄 Limpeza automática (cron semanal)</SelectItem>
                    </SelectContent>
                  </Select>

                  {cleanupMode === "range" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">De</div>
                        <Input type="date" value={cleanupFrom} onChange={(e) => setCleanupFrom(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Até</div>
                        <Input type="date" value={cleanupTo} onChange={(e) => setCleanupTo(e.target.value)} />
                      </div>
                    </div>
                  ) : null}

                  {cleanupMode === "older_than_days" ? (
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Manter últimos (dias)</div>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={cleanupDays}
                        onChange={(e) => setCleanupDays(Number(e.target.value || 30))}
                      />
                    </div>
                  ) : null}
                </DialogBody>

                <DialogFooterSticky className="flex items-center justify-end gap-2">
                  <ConfirmDanger
                    title="Confirmar limpeza"
                    description={
                      cleanupMode === "all"
                        ? "Isso vai apagar TODAS as mensagens enviadas. Não há lixeira e não dá para desfazer."
                        : cleanupMode === "range"
                        ? "Isso vai apagar as mensagens enviadas dentro do período selecionado. Não dá para desfazer."
                        : `Isso vai apagar mensagens enviadas mais antigas que ${cleanupDays} dias. Não dá para desfazer.`
                    }
                    requireText="APAGAR"
                    confirmLabel={purgeSent.isPending ? "Aguarde..." : "Apagar"}
                    confirming={purgeSent.isPending}
                    disabled={purgeSent.isPending || (cleanupMode === "range" && (!cleanupFrom || !cleanupTo))}
                    trigger={
                      <Button className="w-full gap-2" variant="destructive">
                        <Trash2 className="w-4 h-4" /> Confirmar limpeza
                      </Button>
                    }
                    onConfirm={async () => {
                      if (cleanupMode === "all") {
                        await purgeSent.mutateAsync({
                          tenantId: isOwner ? (tenantIdNum ?? null) : null,
                          mode: "all",
                        });
                        return;
                      }

                      if (cleanupMode === "range") {
                        if (!cleanupFrom || !cleanupTo) return toast("Informe o período");
                        const from = new Date(`${cleanupFrom}T00:00:00`);
                        const to = new Date(`${cleanupTo}T23:59:59`);
                        await purgeSent.mutateAsync({
                          tenantId: isOwner ? (tenantIdNum ?? null) : null,
                          mode: "range",
                          from,
                          to,
                        });
                        return;
                      }

                      await purgeSent.mutateAsync({
                        tenantId: isOwner ? (tenantIdNum ?? null) : null,
                        mode: "older_than_days",
                        days: cleanupDays,
                      });
                    }}
                  />
                </DialogFooterSticky>
              </DialogContentScrollable>
            </Dialog>

            {/* send */}
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTargetSearch(""); }}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Send className="w-4 h-4" />
                  Enviar mensagem
                </Button>
              </DialogTrigger>

              <DialogContentScrollable className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Enviar mensagem</DialogTitle>
                </DialogHeader>

                <form
                  className="flex flex-col flex-1 min-h-0"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                >
                  <DialogBody className="space-y-3 flex-1 min-h-0 overflow-auto">
                    <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <Textarea placeholder="Mensagem" value={content} onChange={(e) => setContent(e.target.value)} />

                    {/* Upload */}
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Anexo (opcional)</div>
                      <FileUploader
                        tenantId={isOwner ? (tenantIdNum ?? undefined) : undefined}
                        maxFiles={20}
                        autoUpload
                        onUploadComplete={(fileId, publicUrl, fileKey) => {
                          setAttachments((prev) => {
                            if (prev.length >= 20) {
                              toast.error("Máximo de 20 arquivos por mensagem.");
                              return prev;
                            }
                            return [...prev, { fileId, url: publicUrl, fileKey }];
                          });
                          toast("Anexo enviado");
                        }}
                      />

                      {attachments.length ? (
                        <div className="pt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                          <div className="text-xs text-muted-foreground">Anexos ({attachments.length}/20)</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {attachments.map((a, i) => (
                              <div key={a.fileKey || a.url || i} className="relative rounded-xl border p-2">
                                <MediaViewer url={String(a.fileKey || a.url)} title={title || "Anexo"} />
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="mt-2 w-full"
                                  onClick={() => {
                                    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
                                  }}
                                >
                                  Remover
                                </Button>
                              </div>
                            ))}
                          </div>

                          {attachments.length > 1 ? (
                            <Button type="button" variant="outline" className="w-full" onClick={() => setAttachments([])}>
                              Remover todos
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <Select
                      value={targetType}
                      onValueChange={(v: any) => {
                        setTargetType(v);
                        setTargetIds([]);
                        setTargetSearch("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Destino" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="users">{isOwner ? "Admins específicos" : "Usuários específicos"}</SelectItem>
                        {!isOwner && <SelectItem value="groups">Grupos</SelectItem>}
                      </SelectContent>
                    </Select>

                    {targetType !== "all" ? (
                      <div className="border rounded-xl p-3 space-y-2 max-h-64 overflow-auto">
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              value={targetSearch}
                              onChange={(e) => setTargetSearch(e.target.value)}
                              placeholder={targetType === "users" ? "Buscar usuário específico..." : "Buscar grupo específico..."}
                              className="pl-9"
                            />
                          </div>

                        {filteredAvailableTargets.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            {targetType === "users"
                              ? usersQuery.isLoading
                                ? "Carregando usuários..."
                                : "Nenhum usuário encontrado."
                              : groupsQuery.isLoading
                              ? "Carregando grupos..."
                              : "Nenhum grupo encontrado."}
                          </div>
                        ) : (
                          filteredAvailableTargets.map((t: any) => {
                            const id = Number(t.id);
                            const label =
                              targetType === "users"
                                ? t.name || t.loginId || `Usuário #${id}`
                                : t.name || `Grupo #${id}`;
                            return (
                              <label key={id} className="flex items-center gap-3 py-1 cursor-pointer">
                                <Checkbox checked={targetIds.includes(id)} onCheckedChange={() => toggleId(id)} />
                                <span className="text-sm">{label}</span>
                              </label>
                            );
                          })
                        )}
                        </div>
                      </div>
                    ) : null}
                  </DialogBody>

                  <DialogFooterSticky className="flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={send.isPending}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={send.isPending || !canSend()}>
                      {send.isPending ? "Enviando..." : "Enviar"}
                    </Button>
                  </DialogFooterSticky>
                </form>
              </DialogContentScrollable>
            </Dialog>
          </div>
        </div>

        {/* main */}
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/40 flex justify-between">
            <div className="text-sm text-muted-foreground">Enviadas</div>
            <div className="text-sm text-muted-foreground">
              {listQuery.data?.total ?? (listQuery.data?.data?.length ?? 0)} mensagens
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[340px_1fr]">
            {/* Threads list */}
            <div className={["border-b md:border-b-0 md:border-r", isMobile && mobileMode === "detail" ? "hidden md:block" : "block"].join(" ")}>
              <div className="p-3 flex items-center justify-between">
                <div className="text-sm font-medium">Conversas</div>
                <div className="text-xs text-muted-foreground">{threads.length}</div>
              </div>

              <div className="max-h-[70vh] overflow-auto">
                {threads.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Nenhuma conversa encontrada com os filtros atuais.</div>
                ) : (
                  <div className="p-2 space-y-1">
                    {threads.map((t) => {
                      const active = selectedThread?.key === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => { setSelectedThreadKey(t.key); if (isMobile) setMobileMode("detail"); }}
                          className={[
                            "w-full text-left rounded-xl border px-3 py-2 transition relative overflow-hidden",
                            active ? "bg-muted/60 border-border" : "bg-background hover:bg-muted/40",
                            threadColor(t),
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div
                                className={
                                  "h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 " +
                                  threadAvatarBg(t)
                                }
                              >
                                {initialsFromTitle(t.title)}
                              </div>

                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="font-medium truncate">{t.title}</div>

                                  {t.type === "campaign" ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-background text-muted-foreground">
                                      campanha
                                    </span>
                                  ) : t.type === "group" ? (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-background text-muted-foreground">
                                      grupo
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-background text-muted-foreground">
                                      usuário
                                    </span>
                                  )}
                                </div>

                                {t.subtitle ? (
                                  <div className="text-xs text-muted-foreground truncate mt-0.5">{t.subtitle}</div>
                                ) : null}

                                <div className="text-xs text-muted-foreground truncate mt-1">
                                  <span className="font-medium text-foreground/90">{t.lastTitle || "Mensagem"}</span>
                                  {t.lastBody ? <span className="text-muted-foreground"> — {t.lastBody}</span> : null}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  <span className="text-[11px] text-muted-foreground">
                                    {t.read}/{t.delivered} lidas
                                  </span>

                                  {t.images + t.videos + t.files > 0 ? (
                                    <span className="text-[11px] text-muted-foreground">
                                      • mídia: {t.images ? `${t.images} img` : ""}
                                      {t.images && t.videos ? " / " : ""}
                                      {t.videos ? `${t.videos} vid` : ""}
                                      {(t.images || t.videos) && t.files ? " / " : ""}
                                      {t.files ? `${t.files} arq` : ""}
                                    </span>
                                  ) : null}

                                  {t.failed > 0 ? <span className="text-[11px] text-red-500">• falhas: {t.failed}</span> : null}
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-muted-foreground">
                              {t.lastAt ? formatDateTimeBR(t.lastAt) : ""}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Thread detail */}
            <div className={["min-h-[520px] flex flex-col", isMobile && mobileMode === "list" ? "hidden md:flex" : "flex"].join(" ")}>
              {!selectedThread ? (
                <div className="p-8 text-sm text-muted-foreground">Selecione uma conversa para ver os detalhes.</div>
              ) : (
                <>
                  {/* Header */}
                  <div className="p-4 border-b flex flex-col gap-2">
                    {isMobile ? (
                      <div>
                        <Button type="button" variant="ghost" className="px-0 h-auto" onClick={() => setMobileMode("list")}>
                          <ChevronLeft className="w-4 h-4 mr-1" />
                          Voltar para conversas
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={
                            "h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 " +
                            threadAvatarBg(selectedThread)
                          }
                        >
                          {initialsFromTitle(selectedThread.title)}
                        </div>

                        <div className="min-w-0">
                          <div className="text-base font-semibold truncate">{selectedThread.title}</div>
                          {selectedThread.subtitle ? (
                            <div className="text-sm text-muted-foreground truncate">{selectedThread.subtitle}</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Métricas</div>
                        <div className="text-sm font-medium">
                          {selectedThread.read}/{selectedThread.delivered} lidas
                        </div>
                        {selectedThread.failed > 0 ? (
                          <div className="text-xs text-red-500">{selectedThread.failed} falhas</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{selectedThread.items.length} mensagens</span>
                      {selectedThread.images + selectedThread.videos + selectedThread.files > 0 ? (
                        <span>
                          • anexos: {selectedThread.images ? `${selectedThread.images} imagens` : ""}
                          {selectedThread.images && selectedThread.videos ? " / " : ""}
                          {selectedThread.videos ? `${selectedThread.videos} vídeos` : ""}
                          {(selectedThread.images || selectedThread.videos) && selectedThread.files ? " / " : ""}
                          {selectedThread.files ? `${selectedThread.files} arquivos` : ""}
                        </span>
                      ) : null}
                    </div>


                    {deliveryMapQuery.data ? (
                      <div className="mt-3 rounded-xl border bg-background/60 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-sm font-medium">Mapa de envios da última mensagem</div>
                          <div className="text-xs text-muted-foreground">#{selectedPrimaryNotificationId}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">Enviado {Number(deliveryMapQuery.data.summary.sent ?? 0)}</span>
                          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">Lido {Number(deliveryMapQuery.data.summary.read ?? 0)}</span>
                          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">Falhou {Number(deliveryMapQuery.data.summary.failed ?? 0)}</span>
                          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">Total {Number(deliveryMapQuery.data.summary.total ?? 0)}</span>
                        </div>

                        <div className="mt-3 max-h-[260px] overflow-auto space-y-2 pr-1">
                          {deliveryMapQuery.data.items.slice(0, 40).map((item: any) => (
                            <div key={item.deliveryId} className="rounded-lg border px-3 py-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{item.name}</div>
                                  <div className="text-[11px] text-muted-foreground truncate">
                                    {item.groupNames?.length ? item.groupNames.join(", ") : "Sem grupo"}
                                  </div>
                                </div>
                                <div className="text-[11px] text-right">
                                  <div className={item.isRead ? "text-emerald-400" : item.status === "failed" ? "text-red-400" : "text-muted-foreground"}>
                                    {item.isRead ? "LIDO" : String(item.status || "sent").toUpperCase()}
                                  </div>
                                  {item.errorMessage ? <div className="text-red-400 max-w-[180px] truncate">{item.errorMessage}</div> : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* ✅ Interações + clientes que responderam */}
                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
                      <div className="text-xs text-muted-foreground">
                        Clique em uma mensagem para ver o conteúdo completo e os anexos. As reações são atualizadas em tempo real.
                      </div>

                      <div className="rounded-xl border bg-background/60 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-sm font-medium">Interações</div>
                          <div className="text-xs text-muted-foreground">
                            {selectedNotificationIds.length ? `${selectedNotificationIds.length} envios` : "—"}
                          </div>
                        </div>

                        {(() => {
                          const ids = selectedNotificationIds;
                          const sum = (key: string) =>
                            ids.reduce((acc, id) => acc + Number((feedbackById as any)?.[id]?.[key] ?? 0), 0);
                          const total = ids.reduce((acc, id) => acc + Number((feedbackById as any)?.[id]?.total ?? 0), 0);

                          return (
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                                👍 {sum("liked")}
                              </span>
                              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                                👎 {sum("disliked")}
                              </span>
                              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                                🔁 {sum("renew")}
                              </span>
                              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                                ⛔ {sum("no_renew")}
                              </span>
                              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1">
                                ⚠️ {sum("problem")}
                              </span>
                              <span className="ml-auto text-xs text-muted-foreground">total: {total}</span>
                            </div>
                          );
                        })()}

                        <div className="mt-3">
                          <div className="text-xs text-muted-foreground mb-2">Clientes que responderam</div>

                          <div className="max-h-[220px] overflow-auto space-y-2 pr-1">
                            {selectedNotificationIds.length === 0 ? (
                              <div className="text-xs text-muted-foreground">Selecione uma conversa.</div>
                            ) : (
                              (() => {
                                const items: any[] = [];
                                for (const id of selectedNotificationIds) {
                                  const block = (respondersById as any)?.[id];
                                  if (block?.items?.length) {
                                    items.push(...block.items.map((x: any) => ({ ...x, _nid: id })));
                                  }
                                }

                                items.sort(
                                  (a, b) => new Date(b.feedbackAt || 0).getTime() - new Date(a.feedbackAt || 0).getTime()
                                );

                                if (!items.length) {
                                  return <div className="text-xs text-muted-foreground">Ainda sem feedback dos clientes.</div>;
                                }

                                return items.slice(0, 50).map((r) => {
                                  const meta = FEEDBACK_META[String(r.feedback || "")] || {
                                    label: String(r.feedback || "feedback"),
                                    icon: "💬",
                                  };
                                  const display = (r.name || r.email || r.openId || `User #${r.userId}`) as string;
                                  const when = r.feedbackAt ? new Date(r.feedbackAt).toLocaleString("pt-BR") : "";

                                  return (
                                    <div key={`${r.deliveryId}-${r._nid}`} className="rounded-xl border px-3 py-2">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="text-sm font-medium truncate">{display}</div>
                                          <div className="text-xs text-muted-foreground truncate">
                                            {r.email ? r.email : r.openId ? `@${r.openId}` : ""}
                                          </div>
                                        </div>
                                        <div className="shrink-0 text-xs font-medium">
                                          {meta.icon} <span className="text-muted-foreground">{meta.label}</span>
                                        </div>
                                      </div>
                                      {when ? <div className="mt-1 text-[11px] text-muted-foreground">{when}</div> : null}
                                    </div>
                                  );
                                });
                              })()
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-auto p-4 space-y-3">
                    {[...selectedThread.items]
                      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((n: any) => {
                        // ✅ compat: backend atual expõe "attachments" (files relacionados)
                        const media = asArray<any>(n.attachments ?? n.media);
                        const imageCount = media.filter((m) => (m?.mimeType || m?.mime || "").startsWith("image/")).length;
                        const videoCount = media.filter((m) => (m?.mimeType || m?.mime || "").startsWith("video/")).length;
                        const fileCount = Math.max(0, media.length - imageCount - videoCount);

                        return (
                          <div key={n.id} className="rounded-xl border bg-background p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <div
                                  className={
                                    "h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 " +
                                    threadAvatarBg(selectedThread)
                                  }
                                >
                                  {initialsFromTitle(selectedThread.title)}
                                </div>

                                <div className="min-w-0">
                                  <div className="font-semibold truncate">{n.title || "Mensagem"}</div>
                                  {n.content ? (
                                    <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{n.content}</div>
                                  ) : null}
                                </div>
                              </div>

                              <div className="shrink-0 text-right">
                                <div className="text-xs text-muted-foreground">{formatDateTimeBR(n.createdAt)}</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {n.read}/{n.delivered} lidas
                                  {n.failed > 0 ? <span className="text-red-500"> • {n.failed} falhas</span> : null}
                                </div>
                              </div>
                            </div>

                            {media.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                <div className="text-xs text-muted-foreground">
                                  Anexos ({media.length}) — {imageCount ? `${imageCount} img` : ""}
                                  {imageCount && videoCount ? " / " : ""}
                                  {videoCount ? `${videoCount} vid` : ""}
                                  {(imageCount || videoCount) && fileCount ? " / " : ""}
                                  {fileCount ? `${fileCount} arq` : ""}
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {media.slice(0, 6).map((m: any, i: number) => (
                                    <div key={m?.fileKey || m?.url || i} className="rounded-xl border p-2">
                                      <MediaViewer
                                        // ✅ priorizar fileKey para o MediaViewer renovar signed URL quando necessário.
                                        url={String(m?.fileKey || m?.url)}
                                        title={n.title || "Anexo"}
                                      />
                                    </div>
                                  ))}
                                </div>

                                {media.length > 6 ? (
                                  <div className="text-xs text-muted-foreground">+{media.length - 6} anexos</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
