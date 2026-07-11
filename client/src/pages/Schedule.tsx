import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContentScrollable,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogBody,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Plus, Trash2, Clock, RefreshCw, Pencil, Pause, Play, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";

interface ScheduleData {
  id: number;
  title: string;
  content: string;
  priority: "normal" | "important" | "urgent";
  scheduledFor: Date;
  recurrence: "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  isActive: boolean;
  lastRunAt?: string | Date | null;
  lastRunStatus?: string | null;
  lastRunMessage?: string | null;
  lastNotificationId?: number | null;
  lastTargetCount?: number | null;
  lastSuccessCount?: number | null;
  lastFailureCount?: number | null;
}

export default function SchedulePage() {
  const { isOwner } = useAuth();
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [timelineScheduleId, setTimelineScheduleId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");


  const [ownerTenantId, setOwnerTenantId] = useState<string>("");

  const tenantsQuery = trpc.superadmin.listTenants.useQuery(undefined, {
    enabled: isOwner,
  });

  const [qUsers, setQUsers] = useState("");
  const [qGroups, setQGroups] = useState("");
  const [visibleUsersCount, setVisibleUsersCount] = useState(50);
  const [visibleGroupsCount, setVisibleGroupsCount] = useState(50);

  const [formData, setFormData] = useState({
    title: "",
    content: "",
    priority: "normal" as "normal" | "important" | "urgent",
    targetType: "all" as "all" | "users" | "groups",
    targetIds: [] as number[],
    scheduledFor: "",
    recurrence: "none" as "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly",
  });

  // ✅ OWNER precisa selecionar tenant para listar/enviar (sem quebrar admin)
  useEffect(() => {
    if (isOwner && !ownerTenantId && Array.isArray(tenantsQuery.data) && tenantsQuery.data.length) {
      setOwnerTenantId(String((tenantsQuery.data as any[])[0].id));
    }
  }, [isOwner, ownerTenantId, tenantsQuery.data]);

  const tenantIdNum = isOwner ? (ownerTenantId ? Number(ownerTenantId) : null) : null;
  const ownerHasTenant = !isOwner || Boolean(tenantIdNum);

  const usageTodayQuery = trpc.tenant.getUsageToday.useQuery(undefined, {
    enabled: !isOwner,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const listSchedules = trpc.schedules.list.useQuery(
    isOwner ? { limit: 100, tenantId: tenantIdNum ?? undefined } : { limit: 100 },
    { enabled: ownerHasTenant, refetchInterval: 15000, refetchOnWindowFocus: true }
  );

  
  // 🔎 Para exibir destinatário no card (lista): precisamos resolver nomes por id
  const usersList = trpc.tenant.listMyUsers.useQuery(undefined, {
    enabled: !isOwner && ownerHasTenant,
    refetchOnWindowFocus: false,
  });

  const groupsListForLabels = trpc.groups.list.useQuery(
    { limit: 200 },
    { enabled: !isOwner && ownerHasTenant, refetchOnWindowFocus: false }
  );

  const userNameById = useMemo(() => {
    const m = new Map<number, string>();
    (Array.isArray(usersList.data) ? usersList.data : []).forEach((u: any) => {
      if (u?.id) m.set(Number(u.id), String(u.name || u.loginId || u.openId || u.email || `Usuário #${u.id}`));
    });
    return m;
  }, [usersList.data]);

  const groupNameById = useMemo(() => {
    const m = new Map<number, string>();
    const arr = (groupsListForLabels.data?.data ? groupsListForLabels.data.data : groupsListForLabels.data) as any;
    (Array.isArray(arr) ? arr : []).forEach((g: any) => {
      if (g?.id) m.set(Number(g.id), String(g.name || `Grupo #${g.id}`));
    });
    return m;
  }, [groupsListForLabels.data]);
const groupsListOwner = trpc.superadmin.listGroupsByTenant.useQuery(
    { tenantId: tenantIdNum ?? 0 },
    { enabled: isOwner && isModalOpen && ownerHasTenant && formData.targetType === "groups" }
  );
  const groupsListTenant = trpc.groups.list.useQuery(
    { limit: 100 },
    { enabled: !isOwner && isModalOpen && formData.targetType === "groups" }
  );
  const groupsList = isOwner ? groupsListOwner : groupsListTenant;

  const timelineQuery = trpc.schedules.timeline.useQuery(
    timelineScheduleId ? (isOwner ? { id: timelineScheduleId, tenantId: tenantIdNum ?? undefined } : { id: timelineScheduleId }) : undefined as any,
    { enabled: Boolean(timelineScheduleId) && ownerHasTenant }
  );

  const createSchedule = trpc.schedules.create.useMutation();
  const updateSchedule = trpc.schedules.update.useMutation();
  const deleteSchedule = trpc.schedules.delete.useMutation();
  const toggleSchedule = trpc.schedules.toggle.useMutation();

  // ✅ mesma fonte do modal de enviar mensagem
  const usersQueryOwner = trpc.superadmin.listAdmins.useQuery(undefined, {
    enabled: isOwner && isModalOpen && ownerHasTenant && formData.targetType === "users",
  });
  const usersQueryTenant = trpc.tenant.listMyUsers.useQuery(undefined, {
    enabled: !isOwner && isModalOpen && formData.targetType === "users",
  });
  const usersQuery = isOwner ? usersQueryOwner : usersQueryTenant;

  const availableUsers = useMemo(() => {
    const raw = usersQuery.data as any;
    const arr0 = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.data?.data) ? raw.data.data : [];
    const arr = isOwner ? (arr0 as any[]).filter((u: any) => !tenantIdNum || Number(u.tenantId) === Number(tenantIdNum)) : (arr0 as any[]);
    const q = qUsers.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter((u: any) => {
      const s = `${u.openId ?? ""} ${u.name ?? ""} ${u.email ?? ""}`.toLowerCase();
      return s.includes(q);
    });
  }, [usersQuery.data, qUsers, isOwner, tenantIdNum]);

  const visibleUsers = useMemo(() => {
    return availableUsers.slice(0, visibleUsersCount);
  }, [availableUsers, visibleUsersCount]);

  const availableGroups = useMemo(() => {
    const arr = groups;
    const q = qGroups.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter((g: any) => String(g.name ?? "").toLowerCase().includes(q));
  }, [groups, qGroups]);

  const visibleGroups = useMemo(() => {
    return availableGroups.slice(0, visibleGroupsCount);
  }, [availableGroups, visibleGroupsCount]);

  useEffect(() => {
    // Reset pagination when searching
    setVisibleUsersCount(50);
  }, [qUsers]);

  useEffect(() => {
    setVisibleGroupsCount(50);
  }, [qGroups]);

  useEffect(() => {
    if (listSchedules.data?.data) {
      setSchedules(listSchedules.data.data as any);
    }
  }, [listSchedules.data]);


  useEffect(() => {
    if (groupsList.data?.data) {
      setGroups(groupsList.data.data as any);
    }
  }, [groupsList.data]);

  function resetForm() {
    setEditingId(null);
    setQUsers("");
    setQGroups("");
    setFormData({
      title: "",
      content: "",
      priority: "normal",
      targetType: "all",
      targetIds: [],
      scheduledFor: "",
      recurrence: "none",
    });
  }

  const handleSaveSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.content || !formData.scheduledFor) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        tenantId: isOwner ? (tenantIdNum ?? undefined) : undefined,
        title: formData.title,
        content: formData.content,
        priority: formData.priority,
        targetType: formData.targetType,
        targetIds: formData.targetIds,
        scheduledFor: new Date(formData.scheduledFor),
        recurrence: formData.recurrence,
      } as any;

      if (editingId) {
        await updateSchedule.mutateAsync({ tenantId: isOwner ? (tenantIdNum ?? undefined) : undefined, id: editingId, ...payload });
        toast.success("Agendamento atualizado!");
      } else {
        await createSchedule.mutateAsync(payload);
        toast.success("Agendamento criado com sucesso!");
      }

      setIsModalOpen(false);
      resetForm();
      await listSchedules.refetch();
    } catch (error: any) {
      toast.error("Erro ao agendar: " + (error.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Excluir este agendamento?")) return;
    try {
      await deleteSchedule.mutateAsync({ tenantId: isOwner ? (tenantIdNum ?? undefined) : undefined, id });
      toast.success("Agendamento removido");
      await listSchedules.refetch();
    } catch (error) {
      toast.error("Erro ao remover");
    }
  };

  const handleEdit = (s: any) => {
    setEditingId(Number(s.id));
    setQUsers("");
    setQGroups("");
    // datetime-local -> string local
    const d = new Date(s.scheduledFor);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setFormData({
      title: s.title || "",
      content: s.content || "",
      priority: s.priority || "normal",
      targetType: (s.targetType || "all") as any,
      // normaliza ids (alguns backends serializam como string)
      targetIds: Array.isArray(s.targetIds)
        ? s.targetIds
            .map((v: any) => Number(v))
            .filter((n: number) => Number.isFinite(n))
        : [],
      scheduledFor: local,
      recurrence: (s.recurrence || "none") as any,
    });
    setIsModalOpen(true);
  };

  const handleToggleActive = async (s: any) => {
    try {
      await toggleSchedule.mutateAsync({ tenantId: isOwner ? (tenantIdNum ?? undefined) : undefined, id: Number(s.id), isActive: !Boolean(s.isActive) });
      await listSchedules.refetch();
    } catch {
      toast.error("Erro ao alterar status");
    }
  };

  const setTargetIdChecked = (id: number, checked: boolean) => {
    const nid = Number(id);
    setFormData((prev) => {
      const current = (prev.targetIds || [])
        .map((v: any) => Number(v))
        .filter((n: number) => Number.isFinite(n));

      const has = current.includes(nid);
      const want = Boolean(checked);

      // evita renders extras (e loops em libs controladas)
      if (want === has) return prev;

      return {
        ...prev,
        targetIds: want ? [...current, nid] : current.filter((tid) => tid !== nid),
      };
    });
  };

  const toggleTargetId = (id: number) => {
    const nid = Number(id);
    setFormData((prev) => {
      const current = (prev.targetIds || [])
        .map((v: any) => Number(v))
        .filter((n: number) => Number.isFinite(n));
      const has = current.includes(nid);
      return {
        ...prev,
        targetIds: has ? current.filter((tid) => tid !== nid) : [...current, nid],
      };
    });
  };

  

  const failedSchedules = useMemo(
    () => schedules.filter((s: any) => String(s.lastRunStatus || "") === "failed"),
    [schedules]
  );

  const formatRunStatus = (s: any) => {
    const status = String(s?.lastRunStatus || "");
    if (status === "sent") return { label: "ENVIADO", cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" };
    if (status === "failed") return { label: "FALHOU", cls: "text-red-400 border-red-500/40 bg-red-500/10" };
    if (status === "processing") return { label: "PROCESSANDO", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10" };
    if (status === "partial") return { label: "PARCIAL", cls: "text-amber-200 border-amber-400/40 bg-amber-500/10" };
    return { label: s?.isActive ? "AGUARDANDO" : "PAUSADO", cls: "text-muted-foreground border-border bg-background" };
  };

  const formatDateTime = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR");
  };



  const scheduleSummary = useMemo(() => ({
    total: schedules.length,
    active: schedules.filter((s: any) => Boolean(s.isActive)).length,
    waiting: schedules.filter((s: any) => {
      const status = String(s?.lastRunStatus || "");
      return Boolean(s.isActive) && !status;
    }).length,
    success: schedules.filter((s: any) => String(s?.lastRunStatus || "") === "sent").length,
    failed: schedules.filter((s: any) => ["failed", "partial"].includes(String(s?.lastRunStatus || ""))).length,
  }), [schedules]);

  const formatTargetSummary = (s: any) => {
    const t = String(s?.targetType || "all") as "all" | "users" | "groups";
    const ids = Array.isArray(s?.targetIds) ? s.targetIds.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
    if (t === "all") return { label: "Todos", detail: "" };

    if (t === "users") {
      const names = ids.map((id) => userNameById.get(id) || `Usuário #${id}`);
      const head = names.slice(0, 3).join(", ");
      const tail = names.length > 3 ? ` +${names.length - 3}` : "";
      return { label: `Usuários (${names.length})`, detail: (head ? head + tail : "") };
    }

    const names = ids.map((id) => groupNameById.get(id) || `Grupo #${id}`);
    const head = names.slice(0, 3).join(", ");
    const tail = names.length > 3 ? ` +${names.length - 3}` : "";
    if (names.length === 1) return { label: `users grupo ${names[0]}`, detail: "" };
    return { label: `Grupos (${names.length})`, detail: (head ? head + tail : "") };
  };

  const filteredSchedules = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return schedules;
    return schedules.filter((s: any) => {
      const target = formatTargetSummary(s);
      const hay = [s?.title, s?.content, target.label, target.detail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [schedules, searchTerm, userNameById, groupNameById]);

return (
    <DashboardLayout>
      <div className="p-4 sm:p-8">
        <div className="mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mono mb-2">AGENDAMENTOS</h1>
            <div className="h-1 w-32 bg-primary"></div>
          </div>

          {isOwner ? (
            <div className="w-full sm:w-[280px]">
              <Select value={ownerTenantId} onValueChange={setOwnerTenantId}>
                <SelectTrigger className="border-2">
                  <SelectValue placeholder="Selecionar tenant" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(tenantsQuery.data) ? tenantsQuery.data : []).map((t: any) => (
                    <SelectItem key={String(t.id)} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {failedSchedules.length ? (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
              <div className="font-semibold text-red-300">Atenção: há agendamentos com falha</div>
              <div className="text-red-100/80 mt-1">Verifique os cartões abaixo. Quando um agendamento falhar, o admin verá o motivo e a última tentativa.</div>
            </div>
          ) : null}

          {!isOwner ? (
            <div className="rounded-2xl border border-border bg-card p-4 text-sm min-w-[280px]">
              <div className="font-semibold text-foreground">Créditos de hoje</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-2xl font-bold text-primary">{usageTodayQuery.data?.remaining ?? 0}</span>
                <span className="text-muted-foreground">restantes</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                Usados: {usageTodayQuery.data?.creditsUsed ?? 0} de {usageTodayQuery.data?.limit ?? 0}
              </div>
            </div>
          ) : null}

          <Dialog
            open={isModalOpen}
            onOpenChange={(v) => {
              setIsModalOpen(v);
              if (!v) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 gap-2"
                onClick={() => {
                  setEditingId(null);
                  resetForm();
                }}
              >
                <Plus className="w-4 h-4" /> Novo Agendamento
              </Button>
            </DialogTrigger>
            <DialogContentScrollable className="bg-card border-4 border-border max-w-2xl max-h-[85vh] p-0 gap-0">
              <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2 border-b border-border/60">
                <DialogTitle className="text-2xl mono">
                  {editingId ? "EDITAR AGENDAMENTO" : "PROGRAMAR MENSAGEM"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveSchedule} className="flex min-h-0 flex-1 flex-col">
                <DialogBody className="space-y-4 px-4 sm:px-6 py-4">
                <div className="space-y-2">
                  <Label>Título da Notificação</Label>
                  <Input 
                    value={formData.title} 
                    onChange={e => setFormData({...formData, title: e.target.value})}
                    required className="border-2" 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Conteúdo</Label>
                  <Textarea 
                    value={formData.content} 
                    onChange={e => setFormData({...formData, content: e.target.value})}
                    required className="border-2 min-h-[100px]" 
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Prioridade</Label>
                    <Select 
                      value={formData.priority} 
                      onValueChange={(v: any) => setFormData({...formData, priority: v})}
                    >
                      <SelectTrigger className="border-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="important">Importante</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Data e Hora de Envio</Label>
                    <Input 
                      type="datetime-local"
                      value={formData.scheduledFor} 
                      onChange={e => setFormData({...formData, scheduledFor: e.target.value})}
                      required className="border-2" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Recorrência</Label>
                  <Select 
                    value={formData.recurrence} 
                    onValueChange={(v: any) => setFormData({...formData, recurrence: v})}
                  >
                    <SelectTrigger className="border-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Uma vez</SelectItem>
                      <SelectItem value="hourly">Hora</SelectItem>
                      <SelectItem value="daily">Diária</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Destinatários</Label>
                  <Select 
                    value={formData.targetType} 
                    onValueChange={(v: any) => setFormData({...formData, targetType: v, targetIds: []})}
                  >
                    <SelectTrigger className="border-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {!isOwner && <SelectItem value="groups">Grupos</SelectItem>}
                      <SelectItem value="users">{isOwner ? "Admins específicos" : "Usuários Específicos"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.targetType === "groups" && groups.length > 0 && (
                  <div className="space-y-2 border-2 border-border p-3 rounded">
                    <Label className="font-bold">Selecione os Grupos:</Label>
                    <Input
                      placeholder="Buscar grupo..."
                      value={qGroups}
                      onChange={(e) => setQGroups(e.target.value)}
                      className="border-2"
                    />
                    <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                      {visibleGroups.map(group => (
                        <div key={group.id} className="flex items-center gap-2">
                          <Checkbox 
                            checked={formData.targetIds.includes(group.id)}
                            onCheckedChange={() => toggleTargetId(group.id)}
                          />
                          <label className="text-sm cursor-pointer">{group.name}</label>
                        </div>
                      ))}
                    </div>

                    {availableGroups.length > visibleGroupsCount ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setVisibleGroupsCount((c) => c + 50)}
                      >
                        Mostrar mais grupos
                      </Button>
                    ) : null}
                  </div>
                )}

                {formData.targetType === "users" && (
                  <div className="space-y-2 border-2 border-border p-3 rounded">
                    <Label className="font-bold">Selecione os Usuários:</Label>
                    <Input
                      placeholder="Buscar usuário (nome, email ou login)..."
                      value={qUsers}
                      onChange={(e) => setQUsers(e.target.value)}
                      className="border-2"
                    />
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {usersQuery.isLoading ? (
                        <div className="text-sm text-muted-foreground">Carregando usuários...</div>
                      ) : availableUsers.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Nenhum usuário encontrado.</div>
                      ) : (
                        visibleUsers.map((u: any) => {
                          const id = String(u.id);
                          const checked = formData.targetIds.map(String).includes(id);
                          const inputId = `schedule-user-${id}`;
                          return (
                            <div
                              key={id}
                              className="flex items-start gap-3 p-2 rounded border border-border/40 hover:bg-secondary/30 active:bg-secondary/40 select-none"
                            >
                              <Checkbox
                                id={inputId}
                                checked={checked}
                                onCheckedChange={(v) => setTargetIdChecked(u.id, v === true)}
                              />
                              <label
                                htmlFor={inputId}
                                className="text-sm leading-tight cursor-pointer"
                                onClick={(e) => {
                                  // garante comportamento consistente em mobile/desktop
                                  e.preventDefault();
                                  setTargetIdChecked(u.id, !checked);
                                }}
                              >
                                <div className="font-medium">{u.name ? u.name : u.openId}</div>
                                <div className="text-muted-foreground text-xs mono">
                                  {u.openId}{u.email ? ` • ${u.email}` : ""}
                                </div>
                              </label>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {availableUsers.length > visibleUsersCount ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setVisibleUsersCount((c) => c + 50)}
                      >
                        Mostrar mais usuários
                      </Button>
                    ) : null}
                  </div>
                )}

                </DialogBody>
                <div className="border-t border-border/60 bg-card px-4 sm:px-6 py-3 sm:py-4">
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={loading} className="w-full sm:w-auto sm:min-w-[160px] bg-primary hover:bg-primary/90 gap-2 px-3 py-2 text-sm">
                      {loading ? (editingId ? "SALVANDO..." : "AGENDANDO...") : (
                        <>
                          <Calendar className="w-4 h-4" /> {editingId ? "Salvar" : "Confirmar agendamento"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </DialogContentScrollable>
          </Dialog>
        </div>

        <div className="mb-5">
          <Input
            placeholder="Buscar agendamento por título, conteúdo ou destinatário..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xl"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 mb-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="mt-1 text-2xl font-bold">{scheduleSummary.total}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Ativos</div>
            <div className="mt-1 text-2xl font-bold text-emerald-400">{scheduleSummary.active}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Aguardando</div>
            <div className="mt-1 text-2xl font-bold text-amber-300">{scheduleSummary.waiting}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Concluídos</div>
            <div className="mt-1 text-2xl font-bold text-primary">{scheduleSummary.success}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">Com alerta</div>
            <div className="mt-1 text-2xl font-bold text-red-400">{scheduleSummary.failed}</div>
          </div>
        </div>

        <div className="grid gap-4">
          {filteredSchedules.length === 0 ? (
            <div className="brutalist-card p-12 text-center text-muted-foreground">
              {schedules.length === 0
                ? "Nenhum agendamento programado."
                : "Nenhum agendamento encontrado para a busca atual."}
            </div>
          ) : (
            [...filteredSchedules].sort((a,b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()).map(s => {
              const run = formatRunStatus(s);
              const target = formatTargetSummary(s);
              const hasRun = Boolean(s.lastRunAt || s.lastRunStatus || s.lastRunMessage);
              return (
              <div key={s.id} className="brutalist-card p-4 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="p-3 bg-secondary border-2 border-border shrink-0">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-lg break-words">{s.title}</h3>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-4 mt-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {new Date(s.scheduledFor).toLocaleString(undefined, { timeZone: 'America/Fortaleza' })}</span>
                      {s.recurrence !== 'none' && (
                        <span className="flex items-center gap-1 text-primary font-bold mono">
                          <RefreshCw className="w-3 h-3"/> {s.recurrence.toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        <span className="font-medium text-foreground/90">{target.label}</span>
                      </span>
                      {target.detail ? <span className="truncate">{target.detail}</span> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`px-2.5 py-1 text-[10px] font-bold border-2 ${s.isActive ? 'border-chart-2 text-chart-2' : 'border-muted text-muted-foreground'}`}>
                        {s.isActive ? 'ATIVO' : 'PAUSADO'}
                      </span>
                      <span className={`px-2.5 py-1 text-[10px] font-bold border ${run.cls}`}>
                        {run.label}
                      </span>
                    </div>

                    <div className="mt-3 rounded-xl border border-border/70 bg-secondary/20 p-3 text-sm space-y-1.5">
                      <div className="text-foreground font-medium">Última execução</div>
                      <div className="text-muted-foreground">{formatDateTime(s.lastRunAt) || 'Ainda não executado'}</div>
                      <div className="text-xs text-muted-foreground">
                        Sucesso: <span className="text-foreground font-semibold">{Number(s.lastSuccessCount || 0)}</span>
                        <span className="mx-2">•</span>
                        Falha: <span className="text-foreground font-semibold">{Number(s.lastFailureCount || 0)}</span>
                        <span className="mx-2">•</span>
                        Alvos: <span className="text-foreground font-semibold">{Number(s.lastTargetCount || 0)}</span>
                      </div>
                      {s.lastRunMessage ? (
                        <div className={`text-xs ${String(s.lastRunStatus || '') === 'failed' ? 'text-red-300' : 'text-muted-foreground'}`}>
                          {String(s.lastRunStatus || '') === 'failed' ? 'Motivo da falha: ' : 'Detalhe: '}
                          <span className="font-medium">{s.lastRunMessage}</span>
                        </div>
                      ) : null}
                      {!hasRun && (
                        <div className="text-xs text-muted-foreground">
                          O status deste agendamento também gera aviso na caixa de entrada administrativa quando houver execução, falha ou envio parcial.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => setTimelineScheduleId(Number(s.id))}
                    className="hover:bg-secondary/40"
                    title="Timeline"
                  >
                    Timeline
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleToggleActive(s)}
                    className="hover:bg-secondary/40"
                    title={s.isActive ? "Pausar" : "Ativar"}
                  >
                    {s.isActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => handleEdit(s)}
                    className="hover:bg-secondary/40"
                    title="Editar"
                  >
                    <Pencil className="w-5 h-5" />
                  </Button>
                  <Button variant="ghost" onClick={() => handleDelete(s.id)} className="text-destructive hover:bg-destructive/10">
                    <Trash2 className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            )})
          )}
        </div>

        <Dialog open={Boolean(timelineScheduleId)} onOpenChange={(v) => !v && setTimelineScheduleId(null)}>
          <DialogContentScrollable className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Timeline do agendamento</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-3">
              {timelineQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">Carregando timeline...</div>
              ) : !(timelineQuery.data?.items?.length) ? (
                <div className="text-sm text-muted-foreground">Nenhum evento encontrado.</div>
              ) : (
                timelineQuery.data.items.map((item: any, idx: number) => (
                  <div key={`${item.type}-${item.at}-${idx}`} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.title}</div>
                        {item.description ? <div className="mt-1 text-sm text-muted-foreground">{item.description}</div> : null}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(item.at)}</div>
                    </div>
                  </div>
                ))
              )}
            </DialogBody>
          </DialogContentScrollable>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
