// Users management page
// Design: Brutalismo Digital - tabela de dados densa com ações diretas

import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import SimpleRichTextEditor from "@/components/SimpleRichTextEditor";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogContentScrollable,
  DialogFooterSticky,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import {
  Edit,
  Plus,
  Trash2,
  Crown,
  Shield,
  User as UserIcon,
  Users as UsersIcon,
  KeyRound,
  Share2,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Role = "user" | "admin" | "reseller" | "owner";

export default function Users() {
  const { isOwner, isReseller } = useAuth();
  const utils = trpc.useUtils();

  const isManager = isOwner || isReseller;
  const isTenantAdmin = !isManager;

  // ===== Queries =====
  const ownerUsersQuery = trpc.superadmin.listAdmins.useQuery(undefined, { enabled: isOwner });
  const resellerUsersQuery = trpc.reseller.listAdmins.useQuery(undefined, { enabled: isReseller });
  const tenantUsersQuery = trpc.tenant.listMyUsers.useQuery(undefined, { enabled: isTenantAdmin });
  const users = isOwner ? ownerUsersQuery.data : isReseller ? resellerUsersQuery.data : tenantUsersQuery.data;
  const tenantOverviewQuery = trpc.tenant.adminOverview.useQuery(undefined, { enabled: isTenantAdmin });
  const isLoading = isOwner ? ownerUsersQuery.isLoading : isReseller ? resellerUsersQuery.isLoading : tenantUsersQuery.isLoading;
  const [search, setSearch] = useState("");

  // Tenants (Owner/Revenda)
  const ownerTenantsQuery = trpc.superadmin.listTenants.useQuery(undefined, { enabled: isOwner });
  const resellerTenantsQuery = trpc.reseller.listTenants.useQuery(undefined, { enabled: isReseller });
  const tenants = isOwner ? ownerTenantsQuery.data : resellerTenantsQuery.data;

  // Groups do tenant (apenas Admin)
  const { data: groupsList } = trpc.groups.list.useQuery(
    { limit: 200 },
    { enabled: isTenantAdmin }
  );

  // ===== UI State =====
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  // Modal: grupos do usuário
  const [groupsUser, setGroupsUser] = useState<any | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);


  const genPassword = (len = 10) => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789;._-";
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  };

  const shareText = async (text: string) => {
    try {
      // @ts-ignore
      if (navigator?.share) {
        // @ts-ignore
        await navigator.share({ text });
        toast.success("Credenciais compartilhadas");
        return;
      }
    } catch {
      // ignore share cancel
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Credenciais copiadas");
    } catch {
      window.prompt("Copie as credenciais:", text);
    }
  };

  const shareCredentials = async (loginId: string, password: string) => {
    const msg = `Acesso Notifique-me\nUsuário: ${loginId}\nSenha: ${password}`;
    await shareText(msg);
  };
  // ===== Form state =====
  const [formData, setFormData] = useState({
    name: "",
    loginId: "",
    password: "",
    email: "",
    role: isManager ? (isReseller ? "admin" as Role : "admin" as Role) : "user" as Role,
    tenantId: 0,
    // opcional (admin): já colocar o novo usuário em um grupo existente
    groupId: 0,
    // ✅ card informativo persistente desse usuário
    announcementEnabled: false,
    announcementBody: "",
  });

  const resetForm = () => {
    setFormData({
      name: "",
      loginId: "",
      password: "",
      email: "",
      role: isManager ? (isReseller ? "admin" as Role : "admin" as Role) : "user" as Role,
      tenantId: 0,
      groupId: 0,
      announcementEnabled: false,
      announcementBody: "",
    });
  };

  // ===== Mutations (Owner/Reseller) =====
  const ownerCreateAdmin = trpc.superadmin.createAdmin.useMutation({
    onSuccess: () => {
      toast.success("Admin criado com sucesso");
      // ✅ Compartilhar credenciais (senha só existe agora)
      shareCredentials(formData.loginId, formData.password);
      if (isOwner) utils.superadmin.listAdmins.invalidate(); else utils.reseller.listAdmins.invalidate();
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao criar admin"),
  });

  const resellerCreateAdmin = trpc.reseller.createAdmin.useMutation({
    onSuccess: () => {
      toast.success("Admin criado com sucesso");
      shareCredentials(formData.loginId, formData.password);
      utils.reseller.listAdmins.invalidate();
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao criar admin"),
  });

  const createAdmin = isOwner ? ownerCreateAdmin : resellerCreateAdmin;

  const ownerUpdateAdmin = trpc.superadmin.updateAdmin.useMutation({
    onSuccess: () => {
      toast.success("Usuário atualizado com sucesso");
      if (isOwner) utils.superadmin.listAdmins.invalidate(); else utils.reseller.listAdmins.invalidate();
      setEditingUser(null);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao atualizar usuário"),
  });

  const resellerUpdateAdmin = trpc.reseller.updateAdmin.useMutation({
    onSuccess: () => {
      toast.success("Usuário atualizado com sucesso");
      utils.reseller.listAdmins.invalidate();
      setEditingUser(null);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao atualizar usuário"),
  });

  const updateAdmin = isOwner ? ownerUpdateAdmin : resellerUpdateAdmin;

  const ownerResetAdminPassword = trpc.superadmin.resetAdminPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida. Credenciais prontas para compartilhar.");
    },
    onError: (error) => toast.error(error.message || "Erro ao redefinir senha"),
  });


  const resellerResetAdminPassword = trpc.reseller.resetAdminPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida. Credenciais prontas para compartilhar.");
    },
    onError: (error) => toast.error(error.message || "Erro ao redefinir senha"),
  });

  const resetAdminPassword = isOwner ? ownerResetAdminPassword : resellerResetAdminPassword;


  const ownerDeleteAdmin = trpc.superadmin.deleteAdmin.useMutation({
    onSuccess: () => {
      toast.success("Admin removido com sucesso");
      utils.superadmin.listAdmins.invalidate();
    },
    onError: (error) => toast.error(error.message || "Erro ao remover admin"),
  });

  const resellerDeleteAdmin = trpc.reseller.deleteAdmin.useMutation({
    onSuccess: () => {
      toast.success("Admin removido com sucesso");
      utils.reseller.listAdmins.invalidate();
    },
    onError: (error) => toast.error(error.message || "Erro ao remover admin"),
  });

  const deleteAdmin = isOwner ? ownerDeleteAdmin : resellerDeleteAdmin;

  // ===== Mutations (Admin Tenant) =====
  const createUser = trpc.tenant.createUser.useMutation({
    onSuccess: () => {
      toast.success("Usuário criado com sucesso");
      // ✅ Compartilhar credenciais (senha só existe agora)
      shareCredentials(formData.loginId, formData.password);
      utils.tenant.listMyUsers.invalidate();
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao criar usuário"),
  });

  const updateUser = trpc.tenant.updateUser.useMutation({
    onSuccess: () => {
      toast.success("Usuário atualizado com sucesso");
      utils.tenant.listMyUsers.invalidate();
      setEditingUser(null);
      resetForm();
    },
    onError: (error) => toast.error(error.message || "Erro ao atualizar usuário"),
  });

  const deleteUser = trpc.tenant.deleteUser.useMutation({
    onSuccess: () => {
      toast.success("Usuário removido");
      utils.tenant.listMyUsers.invalidate();
    },
    onError: (error) => toast.error(error.message || "Erro ao remover usuário"),
  });

  const resetPassword = trpc.tenant.resetUserPassword.useMutation({
    onSuccess: () => {
      toast.success("Senha redefinida. Credenciais prontas para compartilhar.");
    },
    onError: (error) => toast.error(error.message || "Erro ao redefinir senha"),
  });

  const getUserGroups = trpc.tenant.getUserGroups.useQuery(
    { id: groupsUser?.id ?? 0 },
    { enabled: !!groupsUser }
  );

  const setUserGroups = trpc.tenant.setUserGroups.useMutation({
    onSuccess: async () => {
      toast.success("Grupos atualizados");

      if (groupsUser?.id) {
        await utils.tenant.getUserGroups.invalidate({ id: groupsUser.id });
      }
      // garante consistência caso você use groups.getMembers em outros lugares
      await utils.groups.list.invalidate();

      setGroupsUser(null);
      setSelectedGroupIds([]);
    },
    onError: (error) => toast.error(error.message || "Erro ao atualizar grupos"),
  });


  const usersList = Array.isArray(users) ? users : [];

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter((user: any) => {
      const hay = [
        user?.name,
        user?.email,
        user?.openId,
        user?.loginId,
        user?.role,
        ...(Array.isArray(user?.groupNames) ? user.groupNames : []),
        String(user?.tenantId ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [usersList, search]);

  const totalUsers = Number(isTenantAdmin ? tenantOverviewQuery.data?.totalUsers ?? filteredUsers.length : filteredUsers.length);
  const activeUsersWithGroups = useMemo(
    () => filteredUsers.filter((user: any) => Array.isArray(user?.groupNames) && user.groupNames.length > 0).length,
    [filteredUsers]
  );
  const usersWithoutGroup = Number(tenantOverviewQuery.data?.usersWithoutGroup ?? 0);
  const usersNeverRead = Number(tenantOverviewQuery.data?.usersNeverRead ?? 0);
  const inactiveUsers30Days = Number(tenantOverviewQuery.data?.inactiveUsers30Days ?? 0);

  // ===== Effects =====
  useEffect(() => {
    if (groupsUser && getUserGroups.data?.groupIds) {
      setSelectedGroupIds(getUserGroups.data.groupIds);
    }
  }, [getUserGroups.data, groupsUser]);

  // ===== Handlers =====
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    if (isManager) {
      if (formData.role !== "reseller" && !formData.tenantId) {
        toast.error("Selecione um tenant para o admin");
        return;
      }
      createAdmin.mutate({
        name: formData.name,
        tenantId: formData.role === "reseller" ? undefined : formData.tenantId,
        loginId: formData.loginId,
        password: formData.password,
        email: formData.email || undefined,
        role: formData.role === "reseller" ? "reseller" : "admin",
      } as any);
      return;
    }

    // Admin tenant cria USER comum
    createUser.mutate({
      name: formData.name,
      loginId: formData.loginId,
      password: formData.password,
      email: formData.email || undefined,
      groupId: formData.groupId ? formData.groupId : undefined,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (isManager) {
      updateAdmin.mutate({
        id: editingUser.id,
        name: formData.name,
        email: formData.email || undefined,
        tenantId: formData.role === "reseller" ? undefined : (formData.tenantId || undefined),
        role: formData.role === "reseller" ? "reseller" : "admin",
      } as any);
      return;
    }

    // Admin tenant: nome/email + card informativo
    updateUser.mutate({
      id: editingUser.id,
      name: formData.name,
      email: formData.email || undefined,
      announcementEnabled: formData.announcementEnabled,
      announcementBody: formData.announcementBody || null,
    });
  };

  const handleAdminDeleteUser = (userId: number) => {
    if (!confirm("Tem certeza que deseja REMOVER este usuário?")) return;
    deleteUser.mutate({ id: userId });
  };

  const openEditDialog = (user: any) => {
    setEditingUser(user);
    setFormData({
      name: user.name || "",
      loginId: user.openId || "",
      password: "",
      email: user.email || "",
      role: (user.role || "user") as any,
      tenantId: user.tenantId || 0,
      groupId: 0,
      announcementEnabled: Boolean(user.announcementEnabled),
      announcementBody: user.announcementBody || "",
    });
  };

  const openGroupsDialog = (user: any) => {
    setGroupsUser(user);
    setSelectedGroupIds([]);
  };

  const toggleGroup = (groupId: number) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((x) => x !== groupId) : [...prev, groupId]
    );
  };

  const saveUserGroups = () => {
    if (!groupsUser) return;
    setUserGroups.mutate({ userId: groupsUser.id, groupIds: selectedGroupIds });
  };

  const getRoleIcon = (role: Role) => {
    switch (role) {
      case "owner":
        return <Crown className="w-4 h-4 text-primary" />;
      case "admin":
        return <Shield className="w-4 h-4 text-chart-2" />;
      case "reseller":
        return <Shield className="w-4 h-4 text-chart-4" />;
      default:
        return <UserIcon className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case "owner":
        return <Badge className="bg-primary text-primary-foreground">OWNER</Badge>;
      case "admin":
        return <Badge className="bg-chart-2 text-white">ADMIN</Badge>;
      case "reseller":
        return <Badge className="bg-chart-4 text-white">REVENDA</Badge>;
      default:
        return <Badge variant="outline">USER</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mono mb-2">USUÁRIOS</h1>
            <div className="h-1 w-32 bg-primary"></div>
            <p className="text-muted-foreground mt-2">
              {isOwner ? "Admins e revendas do sistema" : isReseller ? "Admins dos tenants da sua revenda" : "Usuários do seu tenant"}
            </p>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 gap-2 w-full sm:w-auto">
                <Plus className="w-4 h-4" />
                {isManager ? (isOwner ? "Novo Admin/Revenda" : "Novo Admin") : "Novo Usuário"}
              </Button>
            </DialogTrigger>

            <DialogContent className="bg-card border-2 border-border">
              <DialogHeader>
                <DialogTitle className="text-2xl mono">
                  {isManager ? (isOwner ? "CRIAR ADMIN / REVENDA" : "CRIAR ADMIN") : "CRIAR USUÁRIO"}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome Completo</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="border-2"
                    placeholder={isManager ? "Nome do responsável" : "Nome do usuário"}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Usuário (login)</Label>
                  <Input
                    value={formData.loginId}
                    onChange={(e) => setFormData({ ...formData, loginId: e.target.value })}
                    required
                    className="border-2"
                    placeholder="usuario;56dt68"
                  />
                  <p className="text-xs text-muted-foreground">Pode conter letras, números e ; . _ -</p>
                </div>

                <div className="space-y-2">
                  <Label>Senha</Label>
                  <Input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    className="border-2"
                    placeholder="7h57d7"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Email (opcional)</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="border-2"
                    placeholder="email@exemplo.com"
                  />
                </div>

                {!isOwner && (groupsList as any)?.data?.length ? (
                  <div className="space-y-2">
                    <Label>Grupo (opcional)</Label>
                    <Select
                      value={String(formData.groupId ?? 0)}
                      onValueChange={(value) =>
                        setFormData({ ...formData, groupId: parseInt(value) })
                      }
                    >
                      <SelectTrigger className="border-2">
                        <SelectValue placeholder="Adicionar a um grupo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sem grupo</SelectItem>
                        {(groupsList as any).data.map((g: any) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Você pode mudar depois em “Grupos”.
                    </p>
                  </div>
                ) : null}

                {isManager && (
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select
                      value={formData.role}
                      onValueChange={(value: any) => setFormData({ ...formData, role: value as Role, tenantId: value === "reseller" ? 0 : formData.tenantId })}
                    >
                      <SelectTrigger className="border-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        {isOwner ? <SelectItem value="reseller">Revenda</SelectItem> : null}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {isManager && formData.role !== "reseller" && (
                  <div className="space-y-2">
                    <Label>Tenant (Cliente)</Label>
                    <Select
                      value={formData.tenantId.toString()}
                      onValueChange={(value) =>
                        setFormData({ ...formData, tenantId: parseInt(value) })
                      }
                    >
                      <SelectTrigger className="border-2">
                        <SelectValue placeholder="Selecione um tenant" />
                      </SelectTrigger>
                      <SelectContent>
                        {tenants?.map((tenant: any) => (
                          <SelectItem key={tenant.id} value={tenant.id.toString()}>
                            {tenant.name} ({tenant.slug})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={isOwner ? createAdmin.isPending : createUser.isPending}
                >
                  {(isOwner ? createAdmin.isPending : createUser.isPending)
                    ? "CRIANDO..."
                    : isOwner
                    ? "CRIAR ADMIN"
                    : "CRIAR USUÁRIO"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-5">
          <div className="rounded-2xl border-2 border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total exibido</div>
            <div className="mt-2 text-3xl font-bold mono">{totalUsers}</div>
          </div>
          {!isManager ? (
            <>
              <div className="rounded-2xl border-2 border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Participando de grupos</div>
                <div className="mt-2 text-3xl font-bold mono">{activeUsersWithGroups}</div>
              </div>
              <div className="rounded-2xl border-2 border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Usuários sem grupo</div>
                <div className="mt-2 text-3xl font-bold mono">{usersWithoutGroup}</div>
              </div>
              <div className="rounded-2xl border-2 border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Nunca abriram mensagem</div>
                <div className="mt-2 text-3xl font-bold mono">{usersNeverRead}</div>
                <div className="mt-1 text-xs text-muted-foreground">Inativos há 30+ dias: {inactiveUsers30Days}</div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border-2 border-border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Resultados filtrados</div>
              <div className="mt-2 text-3xl font-bold mono">{filteredUsers.length}</div>
            </div>
          )}
          <div className="rounded-2xl border-2 border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Busca global</div>
            <div className="mt-3 relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isManager ? "Buscar por nome, login, email, role ou tenant..." : "Buscar por nome, login, email ou grupo..."}
                className="pl-9 border-2"
              />
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="brutalist-card overflow-hidden">
          {!isManager && Array.isArray(users) && users.length > 0 ? (
            <div className="px-4 pt-4 text-xs sm:text-sm text-muted-foreground">
              Toque no botão de grupos para ver ou editar a participação de cada usuário.
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary border-b-2 border-border">
                <tr>
                  <th className="text-left p-4 font-bold mono text-sm">ROLE</th>
                  <th className="text-left p-4 font-bold mono text-sm">NOME</th>
                  <th className="text-left p-4 font-bold mono text-sm">EMAIL/LOGIN</th>
                  {isOwner && <th className="text-left p-4 font-bold mono text-sm">TENANT</th>}
                  {isTenantAdmin && <th className="text-left p-4 font-bold mono text-sm">GRUPOS</th>}
                  {isTenantAdmin && <th className="text-left p-4 font-bold mono text-sm">LEITURA</th>}
                  <th className="text-left p-4 font-bold mono text-sm">ÚLTIMO ACESSO</th>
                  <th className="text-right p-4 font-bold mono text-sm">AÇÕES</th>
                </tr>
              </thead>

              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={isOwner ? 6 : isTenantAdmin ? 7 : 5} className="text-center p-8 text-muted-foreground">
                      Carregando usuários...
                    </td>
                  </tr>
                ) : !filteredUsers || filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={isOwner ? 6 : isTenantAdmin ? 7 : 5} className="text-center p-8 text-muted-foreground">
                      Nenhum usuário cadastrado
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user: any) => (
                    <tr key={user.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getRoleIcon(user.role)}
                          {getRoleBadge(user.role)}
                        </div>
                      </td>

                      <td className="p-4 font-medium">{user.name || "Sem nome"}</td>

                      <td className="p-4 mono text-sm text-muted-foreground">
                        {user.email || user.openId}
                      </td>

                      {isOwner && (
                        <td className="p-4 text-sm">
                          {user.tenantId ? (
                            <Badge variant="outline">ID: {user.tenantId}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                      )}

                      {isTenantAdmin && (
                        <td className="p-4 text-sm">
                          {Array.isArray(user.groupNames) && user.groupNames.length ? (
                            <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                              {user.groupNames.map((groupName: string, idx: number) => (
                                <Badge key={`${user.id}-group-${idx}`} variant="outline" className="max-w-full truncate">
                                  {groupName}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Sem grupo</span>
                          )}
                        </td>
                      )}

                      {isTenantAdmin && (
                        <td className="p-4 text-sm">
                          <div className="font-medium">{Number(user.readRate ?? 0)}%</div>
                          <div className="text-xs text-muted-foreground">
                            {Number(user.readCount ?? 0)}/{Number(user.deliveredCount ?? 0)} lidas
                            {Number(user.failedCount ?? 0) > 0 ? ` • ${Number(user.failedCount)} falha(s)` : ""}
                          </div>
                          {user.neverOpenedMessage ? (
                            <div className="text-[11px] text-amber-400">Nunca abriu mensagem</div>
                          ) : null}
                        </td>
                      )}

                      <td className="p-4 text-sm text-muted-foreground">
                        {user.lastSignedIn
                          ? new Date(user.lastSignedIn).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "N/A"}
                        {isTenantAdmin && user.daysSinceLastSignIn !== null && user.daysSinceLastSignIn !== undefined ? (
                          <div className="text-[11px] text-muted-foreground">{user.daysSinceLastSignIn} dia(s) sem entrar</div>
                        ) : null}
                      </td>

                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          {/* Owner actions */}
                          {isManager && user.role !== "owner" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditDialog(user)}
                                className="border-2"
                                title="Editar / Role"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  const pwd = genPassword();
                                  const ok = confirm(
                                    "Isso vai redefinir a senha e gerar novas credenciais para compartilhar. Continuar?"
                                  );
                                  if (!ok) return;
                                  await resetAdminPassword.mutateAsync({ id: user.id, password: pwd });
                                  await shareCredentials(user.openId, pwd);
                                }}
                                className="border-2"
                                title="Compartilhar credenciais"
                              >
                                <Share2 className="w-4 h-4" />
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (!confirm(`Remover ${user.name || user.openId}?`)) return;
                                  deleteAdmin.mutate(user.id);
                                }}
                                className="border-2 text-destructive hover:bg-destructive/10"
                                title="Excluir"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}

                          {/* Admin tenant actions */}
                          {isTenantAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditDialog(user)}
                                className="border-2"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>

                              {user.role === "user" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openGroupsDialog(user)}
                                    className="border-2"
                                    title="Grupos"
                                  >
                                    <UsersIcon className="w-4 h-4" />
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                    const pwd = genPassword();
                                    const ok = confirm(
                                      "Isso vai redefinir a senha deste usuário e gerar novas credenciais para compartilhar. Continuar?"
                                    );
                                    if (!ok) return;
                                    await resetPassword.mutateAsync({ id: user.id, password: pwd });
                                    await shareCredentials(user.openId, pwd);
                                  }}
                                    className="border-2"
                                    title="Compartilhar credenciais"
                                  >
                                    <Share2 className="w-4 h-4" />
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAdminDeleteUser(user.id)}
                                    className="border-2 text-destructive hover:bg-destructive/10"
                                    title="Remover"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Edit Dialog */}
        <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
          <DialogContent className="bg-card border-2 border-border">
            <DialogHeader>
              <DialogTitle className="text-2xl mono">EDITAR USUÁRIO</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="border-2"
                />
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="border-2"
                  placeholder="email@exemplo.com"
                />
              </div>

              {!isManager && (
                <div className="space-y-3 rounded-lg border-2 p-3">
                  <div className="flex items-center justify-between">
                    <Label className="mb-0">Card informativo persistente</Label>
                    <Switch
                      checked={formData.announcementEnabled}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, announcementEnabled: checked })
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mensagem fixa mostrada só pra esse usuário na tela de notificações
                    (ex: "Troque o óleo em 12/07/2027"). Não some sozinha — fica até você
                    desligar ou apagar o texto.
                  </p>
                  <SimpleRichTextEditor
                    value={formData.announcementBody}
                    onChange={(next) => setFormData({ ...formData, announcementBody: next })}
                    placeholder='Ex: Seu carro tem que trocar o óleo dia 12/07/2027'
                  />
                </div>
              )}

              {isManager && (
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={formData.role} onValueChange={(value: any) => setFormData({ ...formData, role: value as Role, tenantId: value === "reseller" ? 0 : formData.tenantId })}>
                    <SelectTrigger className="border-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      {isOwner ? <SelectItem value="reseller">Revenda</SelectItem> : null}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isManager && formData.role !== "reseller" && (
                <div className="space-y-2">
                  <Label>Tenant</Label>
                  <Select
                    value={formData.tenantId?.toString() || "0"}
                    onValueChange={(value) =>
                      setFormData({ ...formData, tenantId: parseInt(value) || 0 })
                    }
                  >
                    <SelectTrigger className="border-2">
                      <SelectValue placeholder="Selecione um tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Nenhum (Sistema)</SelectItem>
                      {tenants?.map((tenant: any) => (
                        <SelectItem key={tenant.id} value={tenant.id.toString()}>
                          {tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(isOwner || isTenantAdmin) && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-2"
                  onClick={async () => {
                    if (!editingUser) return;
                    const pwd = genPassword();
                    const ok = confirm(
                      "Isso vai redefinir a senha deste usuário e gerar novas credenciais para compartilhar. Continuar?"
                    );
                    if (!ok) return;

                    if (isManager) {
                      await resetAdminPassword.mutateAsync({ id: editingUser.id, password: pwd });
                      await shareCredentials(editingUser.openId, pwd);
                      return;
                    }

                    await resetPassword.mutateAsync({ id: editingUser.id, password: pwd });
                    await shareCredentials(editingUser.openId, pwd);
                  }}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Compartilhar credenciais
                </Button>
              )}

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90"
                disabled={isOwner ? updateAdmin.isPending : updateUser.isPending}
              >
                {(isOwner ? updateAdmin.isPending : updateUser.isPending) ? "SALVANDO..." : "SALVAR"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Groups Dialog (Admin tenant) */}
        <Dialog
          open={!!groupsUser}
          onOpenChange={(open) => {
            if (!open) {
              setGroupsUser(null);
              setSelectedGroupIds([]);
            }
          }}
        >
          <DialogContentScrollable className="bg-card border-2 border-border max-w-xl p-0 max-h-[92vh]">
            <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 border-b border-border shrink-0">
              <DialogTitle className="text-xl sm:text-2xl mono pr-10">GRUPOS DO USUÁRIO</DialogTitle>
            </DialogHeader>

            <DialogBody className="px-4 sm:px-6 pb-0">
              <div className="space-y-3 py-4">
                <div className="text-sm text-muted-foreground">
                  Usuário:{" "}
                  <span className="font-medium text-foreground">
                    {groupsUser?.name || groupsUser?.openId}
                  </span>
                </div>

                <div className="border-2 border-border p-3 bg-secondary/30 max-h-[52vh] overflow-auto">
                  {groupsList?.data?.length ? (
                    <div className="space-y-2">
                      {groupsList.data.map((g: any) => (
                        <label
                          key={g.id}
                          className="flex items-start gap-3 p-2.5 border border-border bg-card hover:bg-secondary/40 cursor-pointer rounded-md"
                        >
                          <Checkbox
                            checked={selectedGroupIds.includes(g.id)}
                            onCheckedChange={() => toggleGroup(g.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium break-words">{g.name}</div>
                            {g.description ? (
                              <div className="text-xs text-muted-foreground break-words">
                                {g.description}
                              </div>
                            ) : null}
                          </div>
                          <Badge variant="outline" className="shrink-0">#{g.id}</Badge>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Nenhum grupo encontrado. Crie grupos na tela “Groups”.
                    </div>
                  )}
                </div>
              </div>

              <DialogFooterSticky className="-mx-4 sm:-mx-6 px-4 sm:px-6">
                <Button type="button" variant="outline" className="border-2 w-full sm:w-auto" onClick={() => setGroupsUser(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                  onClick={saveUserGroups}
                  disabled={setUserGroups.isPending}
                >
                  {setUserGroups.isPending ? "SALVANDO..." : "Salvar grupos"}
                </Button>
              </DialogFooterSticky>
            </DialogBody>
          </DialogContentScrollable>
        </Dialog>

        {/* Info */}
        <div className="mt-6 p-4 bg-secondary border-2 border-border">
          <p className="text-sm text-muted-foreground">
            <strong>Roles:</strong>
            <span className="ml-2">
              <Crown className="w-3 h-3 inline" /> Owner = Super Admin do sistema
            </span>
            <span className="ml-2">
              <Shield className="w-3 h-3 inline" /> Admin = Administrador de um tenant
            </span>
            <span className="ml-2">
              <UserIcon className="w-3 h-3 inline" /> User = Usuário comum
            </span>
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
