import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Building2, 
  Bell, 
  Plus, 
  Trash2, 
  Calendar, 
  ShieldAlert,
  RefreshCw,
  Crown,
  AlertCircle,
  Palette,
  Eraser
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContentScrollable,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogBody,
  DialogFooterSticky,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SuperAdmin() {
  const { isOwner, isReseller, userData, loading } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  
  // Redirecionar se não for owner
  useEffect(() => {
    if (!loading && !isOwner && !isReseller) {
      toast.error("Acesso negado.");
      setLocation("/dashboard");
    }
  }, [isOwner, isReseller, loading, setLocation]);
  
  const ownerStatsQuery = trpc.superadmin.getStats.useQuery(undefined, { enabled: isOwner });
  const resellerStatsQuery = trpc.reseller.getStats.useQuery(undefined, { enabled: isReseller });
  const ownerTenantsQuery = trpc.superadmin.listTenants.useQuery(undefined, { enabled: isOwner });
  const resellerTenantsQuery = trpc.reseller.listTenants.useQuery(undefined, { enabled: isReseller });
  const stats = isOwner ? ownerStatsQuery.data : resellerStatsQuery.data;
  const tenants = isOwner ? ownerTenantsQuery.data : resellerTenantsQuery.data;
  const isLoading = isOwner ? ownerTenantsQuery.isLoading : resellerTenantsQuery.isLoading;

  const ownerCreateTenant = trpc.superadmin.createTenant.useMutation({
    onSuccess: () => {
      toast.success("Cliente cadastrado com sucesso!");
      if (isOwner) { utils.superadmin.listTenants.invalidate(); utils.superadmin.getStats.invalidate(); }
      else { utils.reseller.listTenants.invalidate(); utils.reseller.getStats.invalidate(); }
      setIsCreateOpen(false);
      setNewTenant({ name: "", slug: "", plan: "basic", months: 1 });
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar cliente");
    }
  });

  const resellerCreateTenant = trpc.reseller.createTenant.useMutation({
    onSuccess: () => {
      toast.success("Cliente cadastrado com sucesso!");
      utils.reseller.listTenants.invalidate();
      utils.reseller.getStats.invalidate();
      setIsCreateOpen(false);
      setNewTenant({ name: "", slug: "", plan: "basic", months: 1 });
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar cliente");
    }
  });

  const createTenant = isOwner ? ownerCreateTenant : resellerCreateTenant;

  const ownerDeleteTenant = trpc.superadmin.deleteTenant.useMutation({
    onSuccess: () => {
      toast.success("Cliente removido.");
      if (isOwner) { utils.superadmin.listTenants.invalidate(); utils.superadmin.getStats.invalidate(); }
      else { utils.reseller.listTenants.invalidate(); utils.reseller.getStats.invalidate(); }
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover cliente");
    }
  });

  const resellerDeleteTenant = trpc.reseller.deleteTenant.useMutation({
    onSuccess: () => {
      toast.success("Cliente removido.");
      utils.reseller.listTenants.invalidate();
      utils.reseller.getStats.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover cliente");
    }
  });

  const deleteTenant = isOwner ? ownerDeleteTenant : resellerDeleteTenant;

  const ownerRenewSubscription = trpc.tenant.renewSubscription.useMutation({
    onSuccess: (data) => {
      toast.success(`Assinatura renovada até ${new Date(data.newExpiry).toLocaleDateString('pt-BR')}`);
      if (isOwner) utils.superadmin.listTenants.invalidate(); else utils.reseller.listTenants.invalidate();
      setIsRenewOpen(false);
    },
    onError: (error) => {
      toast.error("Erro ao renovar: " + error.message);
    }
  });

  const resellerRenewSubscription = trpc.reseller.renewSubscription.useMutation({
    onSuccess: (data) => {
      toast.success(`Assinatura renovada até ${new Date(data.newExpiry).toLocaleDateString('pt-BR')}`);
      utils.reseller.listTenants.invalidate();
      setIsRenewOpen(false);
    },
    onError: (error) => {
      toast.error("Erro ao renovar: " + error.message);
    }
  });

  const renewSubscription = isOwner ? ownerRenewSubscription : resellerRenewSubscription;

  const ownerSetExpiryDate = trpc.superadmin.setExpiryDate.useMutation({
    onSuccess: () => {
      toast.success("Vencimento atualizado!");
      utils.superadmin.listTenants.invalidate();
      setIsExpiryOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao atualizar vencimento");
    },
  });

  const resellerSetExpiryDate = trpc.reseller.setExpiryDate.useMutation({
    onSuccess: () => {
      toast.success("Vencimento atualizado!");
      if (isOwner) utils.superadmin.listTenants.invalidate(); else utils.reseller.listTenants.invalidate();
      setIsExpiryOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao atualizar vencimento");
    },
  });

  const ownerUpdateTenant = trpc.superadmin.updateTenant.useMutation({
    onSuccess: () => {
      toast.success("Branding atualizado!");
      utils.superadmin.listTenants.invalidate();
      setIsBrandingOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar branding");
    },
  });

  const resellerUpdateTenant = trpc.reseller.updateTenant.useMutation({
    onSuccess: () => {
      toast.success("Branding atualizado!");
      utils.reseller.listTenants.invalidate();
      setIsBrandingOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao salvar branding");
    },
  });

  const updateTenantBranding = isOwner ? ownerUpdateTenant : resellerUpdateTenant;

  const ownerClearBranding = trpc.superadmin.updateTenant.useMutation({
    onSuccess: () => {
      toast.success("Branding removido!");
      utils.superadmin.listTenants.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover branding");
    },
  });

  const resellerClearBranding = trpc.reseller.updateTenant.useMutation({
    onSuccess: () => {
      toast.success("Branding removido!");
      utils.reseller.listTenants.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover branding");
    },
  });

  const clearTenantBranding = isOwner ? ownerClearBranding : resellerClearBranding;

  const setExpiryDate = isOwner ? ownerSetExpiryDate : resellerSetExpiryDate;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [isExpiryOpen, setIsExpiryOpen] = useState(false);
  const [isBrandingOpen, setIsBrandingOpen] = useState(false);
  const [selectedBrandingTenantId, setSelectedBrandingTenantId] = useState<number | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [selectedExpiryTenantId, setSelectedExpiryTenantId] = useState<number | null>(null);
  const [renewMonths, setRenewMonths] = useState(1);
  const [expiryDate, setExpiryDateValue] = useState<string>(""); // yyyy-mm-dd
  const [brandingForm, setBrandingForm] = useState({
    brandName: "",
    brandLogoUrl: "",
    brandPrimaryColor: "",
    supportPhone: "",
    pixKey: "",
    mercadoPagoLink: "",
  });
  
  const [newTenant, setNewTenant] = useState({
    name: "",
    slug: "",
    plan: "basic" as "basic" | "pro" | "enterprise",
    months: 1
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createTenant.mutate({
      name: newTenant.name,
      slug: newTenant.slug,
      plan: newTenant.plan,
      months: newTenant.months
    });
  };

  const handleRenew = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTenantId) {
      renewSubscription.mutate({
        tenantId: selectedTenantId,
        months: renewMonths
      });
    }
  };

  const handleSetExpiry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExpiryTenantId) return;
    const v = (expiryDate || "").trim();
    setExpiryDate.mutate({
      id: selectedExpiryTenantId,
      expiresAt: v ? new Date(v + "T00:00:00.000Z").toISOString() : null,
    });
  };

  const openBrandingDialog = (tenant: any) => {
    setSelectedBrandingTenantId(tenant.id);
    setBrandingForm({
      brandName: tenant.brandName || "",
      brandLogoUrl: tenant.brandLogoUrl || "",
      brandPrimaryColor: tenant.brandPrimaryColor || "",
      supportPhone: tenant.supportPhone || "",
      pixKey: tenant.pixKey || "",
      mercadoPagoLink: tenant.mercadoPagoLink || "",
    });
    setIsBrandingOpen(true);
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrandingTenantId) return;
    updateTenantBranding.mutate({
      id: selectedBrandingTenantId,
      brandName: brandingForm.brandName.trim() || null,
      brandLogoUrl: brandingForm.brandLogoUrl.trim() || null,
      brandPrimaryColor: brandingForm.brandPrimaryColor.trim() || null,
      supportPhone: brandingForm.supportPhone.trim() || null,
      pixKey: brandingForm.pixKey.trim() || null,
      mercadoPagoLink: brandingForm.mercadoPagoLink.trim() || null,
    });
  };

  const handleClearBranding = (tenantId: number) => {
    if (!confirm("Remover todo o branding deste tenant?")) return;
    clearTenantBranding.mutate({
      id: tenantId,
      brandName: null,
      brandLogoUrl: null,
      brandPrimaryColor: null,
      supportPhone: null,
      pixKey: null,
      mercadoPagoLink: null,
    });
  };

  // Se ainda está carregando ou não é owner, não renderizar
  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-8 flex items-center justify-center">
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!isOwner && !isReseller) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="brutalist-card p-8 text-center">
            <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-destructive mb-2">Acesso Negado</h1>
            <p className="text-muted-foreground">
              Esta página é exclusiva para o Owner e Revendas.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Seu role atual: <strong>{userData?.role || 'desconhecido'}</strong>
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-foreground mono mb-2 flex items-center gap-3">
              <Crown className="w-10 h-10 text-primary" />
              {isOwner ? "ÁREA DO DONO" : "ÁREA DA REVENDA"}
            </h1>
            <div className="h-1 w-32 bg-primary"></div>
            <p className="text-muted-foreground mt-2">
              {isOwner ? "Gerencie todos os clientes e licenças do sistema." : "Gerencie apenas os clientes da sua revenda."}
            </p>
          </div>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 gap-2">
                <Plus className="w-4 h-4" /> Novo Cliente
              </Button>
            </DialogTrigger>
            <DialogContentScrollable className="bg-card border-4 border-border">
              <DialogHeader>
                <DialogTitle className="text-2xl mono">CADASTRAR NOVO CLIENTE</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <DialogBody className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome da Empresa</Label>
                    <Input 
                      value={newTenant.name}
                      onChange={e => setNewTenant({...newTenant, name: e.target.value})}
                      placeholder="Ex: Academia Fit"
                      required
                      className="border-2"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Slug (Identificador único)</Label>
                    <Input 
                      value={newTenant.slug}
                      onChange={e => setNewTenant({...newTenant, slug: e.target.value.toLowerCase().replace(/\s+/g, '-')})}
                      placeholder="ex: academia-fit"
                      required
                      className="border-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      Será usado como identificador único. Use apenas letras minúsculas e hífens.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Plano</Label>
                      <Select 
                        value={newTenant.plan}
                        onValueChange={(v: any) => setNewTenant({...newTenant, plan: v})}
                      >
                        <SelectTrigger className="border-2"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Meses de Licença</Label>
                      <Input 
                        type="number"
                        value={newTenant.months}
                        onChange={e => setNewTenant({...newTenant, months: parseInt(e.target.value) || 1})}
                        min={1}
                        required
                        className="border-2"
                      />
                    </div>
                  </div>
                </DialogBody>

                <DialogFooterSticky>
                  <Button 
                    type="submit" 
                    className="w-full bg-primary" 
                    disabled={createTenant.isPending}
                  >
                    {createTenant.isPending ? "CADASTRANDO..." : "CADASTRAR CLIENTE"}
                  </Button>
                </DialogFooterSticky>
              </form>
            </DialogContentScrollable>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="border-4 border-border brutalist-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold uppercase">Total de Clientes</CardTitle>
              <Building2 className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mono">{stats?.totalTenants || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-4 border-border brutalist-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold uppercase">Usuários Totais</CardTitle>
              <Users className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mono">{stats?.totalUsers || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-4 border-border brutalist-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold uppercase">Notificações Enviadas</CardTitle>
              <Bell className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mono">{stats?.totalNotifications || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Tenants List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold uppercase flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" /> Gerenciamento de Licenças
          </h2>
          
          {isLoading ? (
            <div className="p-12 text-center animate-pulse">Carregando clientes...</div>
          ) : tenants?.length === 0 ? (
            <div className="p-12 border-4 border-dashed border-border text-center text-muted-foreground">
              Nenhum cliente cadastrado ainda. Clique em "Novo Cliente" para começar.
            </div>
          ) : (
            <div className="grid gap-4">
              {tenants?.map(tenant => (
                <div
                  key={tenant.id}
                  className="brutalist-card p-6 bg-card border-4 border-border flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                    <div className="p-4 bg-secondary border-2 border-border">
                      <Building2 className="w-8 h-8" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold uppercase">{tenant.name}</h3>
                      <p className="text-sm text-muted-foreground mono">slug: {tenant.slug}</p>
                      <div className="flex gap-3 mt-2 flex-wrap">
                        <Badge className={`uppercase ${
                          tenant.plan === 'enterprise' ? 'bg-purple-500' :
                          tenant.plan === 'pro' ? 'bg-blue-500' : ''
                        }`}>
                          {tenant.plan}
                        </Badge>
                        <Badge variant={tenant.status === 'active' ? 'default' : 'destructive'} className="uppercase">
                          {tenant.status}
                        </Badge>
                        <span className="text-xs flex items-center gap-1 text-muted-foreground">
                          <Calendar className="w-3 h-3" /> 
                          Expira em: {tenant.subscriptionExpiresAt ? (() => {
                            try {
                              return format(new Date(tenant.subscriptionExpiresAt), "dd/MM/yyyy");
                            } catch (e) {
                              return "Data Inválida";
                            }
                          })() : "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto justify-end">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="border-2 gap-2 w-full sm:w-auto"
                      onClick={() => {
                        setSelectedTenantId(tenant.id);
                        setRenewMonths(1);
                        setIsRenewOpen(true);
                      }}
                    >
                      <RefreshCw className="w-4 h-4" /> Renovar
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="border-2 gap-2 w-full sm:w-auto"
                      onClick={() => {
                        setSelectedExpiryTenantId(tenant.id);
                        // preenche yyyy-mm-dd
                        const d = tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt) : null;
                        if (d && !Number.isNaN(d.getTime())) {
                          const yyyy = d.getFullYear();
                          const mm = String(d.getMonth() + 1).padStart(2, "0");
                          const dd = String(d.getDate()).padStart(2, "0");
                          setExpiryDateValue(`${yyyy}-${mm}-${dd}`);
                        } else {
                          setExpiryDateValue("");
                        }
                        setIsExpiryOpen(true);
                      }}
                    >
                      <Calendar className="w-4 h-4" /> Vencimento
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="border-2 gap-2 w-full sm:w-auto"
                      onClick={() => openBrandingDialog(tenant)}
                    >
                      <Palette className="w-4 h-4" /> Editar
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="border-2 gap-2 w-full sm:w-auto text-amber-300 hover:text-amber-200"
                      onClick={() => handleClearBranding(tenant.id)}
                      disabled={clearTenantBranding.isPending}
                    >
                      <Eraser className="w-4 h-4" /> Limpar
                    </Button>

                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:bg-destructive/10 w-[52px] shrink-0"
                      onClick={() => {
                        if(confirm("Tem certeza que deseja remover este cliente? Todos os usuários serão desassociados.")) {
                          deleteTenant.mutate(tenant.id);
                        }
                      }}
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Dialog open={isBrandingOpen} onOpenChange={setIsBrandingOpen}>
          <DialogContentScrollable className="bg-card border-4 border-border">
            <DialogHeader>
              <DialogTitle className="text-2xl mono">EDITAR BRANDING</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveBranding} className="space-y-4">
              <DialogBody className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome da marca</Label>
                  <Input
                    value={brandingForm.brandName}
                    onChange={(e) => setBrandingForm({ ...brandingForm, brandName: e.target.value })}
                    placeholder="Ex: NATV de Sua Casa"
                    className="border-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>URL da logo</Label>
                  <Input
                    value={brandingForm.brandLogoUrl}
                    onChange={(e) => setBrandingForm({ ...brandingForm, brandLogoUrl: e.target.value })}
                    placeholder="https://..."
                    className="border-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Cor principal</Label>
                  <Input
                    value={brandingForm.brandPrimaryColor}
                    onChange={(e) => setBrandingForm({ ...brandingForm, brandPrimaryColor: e.target.value })}
                    placeholder="#e11d48"
                    className="border-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Telefone de suporte</Label>
                  <Input
                    value={brandingForm.supportPhone}
                    onChange={(e) => setBrandingForm({ ...brandingForm, supportPhone: e.target.value })}
                    placeholder="83999999999"
                    className="border-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Chave PIX</Label>
                  <Input
                    value={brandingForm.pixKey}
                    onChange={(e) => setBrandingForm({ ...brandingForm, pixKey: e.target.value })}
                    placeholder="Sua chave PIX"
                    className="border-2"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Link Mercado Pago</Label>
                  <Input
                    value={brandingForm.mercadoPagoLink}
                    onChange={(e) => setBrandingForm({ ...brandingForm, mercadoPagoLink: e.target.value })}
                    placeholder="https://..."
                    className="border-2"
                  />
                </div>
              </DialogBody>

              <DialogFooterSticky>
                <Button type="submit" className="w-full bg-primary" disabled={updateTenantBranding.isPending}>
                  {updateTenantBranding.isPending ? "SALVANDO..." : "SALVAR BRANDING"}
                </Button>
              </DialogFooterSticky>
            </form>
          </DialogContentScrollable>
        </Dialog>

        {/* Dialog de Renovação */}
        <Dialog open={isRenewOpen} onOpenChange={setIsRenewOpen}>
          <DialogContentScrollable className="bg-card border-4 border-border">
            <DialogHeader>
              <DialogTitle className="text-2xl mono">RENOVAR ASSINATURA</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleRenew} className="space-y-4">
              <DialogBody className="space-y-4">
                <div className="space-y-2">
                  <Label>Quantos meses deseja adicionar?</Label>
                  <Input 
                    type="number"
                    value={renewMonths}
                    onChange={e => setRenewMonths(parseInt(e.target.value) || 1)}
                    min={1}
                    max={36}
                    required
                    placeholder="Ex: 12"
                    className="border-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    A nova data de vencimento será calculada a partir da data atual de expiração.
                  </p>
                </div>
              </DialogBody>

              <DialogFooterSticky>
                <Button 
                  type="submit" 
                  className="w-full bg-primary" 
                  disabled={renewSubscription.isPending}
                >
                  {renewSubscription.isPending ? "RENOVANDO..." : "CONFIRMAR RENOVAÇÃO"}
                </Button>
              </DialogFooterSticky>
            </form>
          </DialogContentScrollable>
        </Dialog>

        {/* Dialog de Vencimento (data direta) */}
        <Dialog open={isExpiryOpen} onOpenChange={setIsExpiryOpen}>
          <DialogContentScrollable className="bg-card border-4 border-border">
            <DialogHeader>
              <DialogTitle className="text-2xl mono">DEFINIR VENCIMENTO</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSetExpiry} className="space-y-4">
              <DialogBody className="space-y-4">
              <div className="space-y-2">
                <Label>Data de vencimento</Label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDateValue(e.target.value)}
                  className="border-2"
                />
                <p className="text-xs text-muted-foreground">
                  Você pode deixar vazio para remover a data de expiração.
                </p>
              </div>
              </DialogBody>
              <DialogFooterSticky>
                <Button type="submit" className="w-full bg-primary" disabled={setExpiryDate.isPending}>
                  {setExpiryDate.isPending ? "SALVANDO..." : "SALVAR"}
                </Button>
              </DialogFooterSticky>
            </form>
          </DialogContentScrollable>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
