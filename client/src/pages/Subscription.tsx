import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, CreditCard, ShieldCheck, AlertTriangle, Crown, RefreshCw, Palette, Users, Send, Copy } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Subscription() {
  const { data: subscription, isLoading, error, refetch } = trpc.tenant.getSubscription.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const { data: catalog } = trpc.tenant.getPlanCatalog.useQuery();
  const { data: usageToday } = trpc.tenant.getUsageToday.useQuery(undefined, {
    enabled: Boolean(subscription) && !subscription?.isSuperAdmin,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const saveBranding = trpc.tenant.updateBranding.useMutation({
    onSuccess: async () => {
      toast.success("White-label salvo com sucesso");
      await refetch();
    },
    onError: (err) => toast.error(err.message || "Falha ao salvar branding"),
  });

  const [brandName, setBrandName] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [mercadoPagoLink, setMercadoPagoLink] = useState("");

  useEffect(() => {
    if (!subscription?.branding) return;
    setBrandName(subscription.branding.brandName || "");
    setBrandLogoUrl(subscription.branding.brandLogoUrl || "");
    setBrandPrimaryColor(subscription.branding.brandPrimaryColor || "");
    setSupportPhone(subscription.branding.supportPhone || "");
    setPixKey(subscription.branding.pixKey || "");
    setMercadoPagoLink(subscription.branding.mercadoPagoLink || "");
  }, [subscription?.branding]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="animate-pulse font-bold mono">CARREGANDO DETALHES DO PLANO...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !subscription) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="p-6 border-4 border-destructive bg-destructive/10 text-destructive brutalist-card">
            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2 uppercase">
              <AlertTriangle /> Erro de Conexão
            </h2>
            <p className="mb-4">{error?.message || "Não foi possível carregar o plano."}</p>
            <Button onClick={() => refetch()} variant="outline" className="border-2 border-destructive hover:bg-destructive hover:text-white gap-2">
              <RefreshCw className="w-4 h-4" /> Tentar Novamente
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const canWhiteLabelByPlan = Boolean(subscription?.limits?.whiteLabel);
  const canEditWhiteLabel = canWhiteLabelByPlan && !subscription?.isOwner && !subscription?.isSuperAdmin;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-foreground mono mb-2 uppercase">
            {subscription.isSuperAdmin ? "Planos & Cobrança" : "Plano, Cobrança e White-label"}
          </h1>
          <div className="h-1 w-40 bg-primary"></div>
        </div>

        {subscription.isSuperAdmin && (
          <div className="p-4 bg-primary/10 border-2 border-primary flex items-center gap-3">
            <Crown className="w-6 h-6 text-primary" />
            <span className="font-bold uppercase">Owner com acesso global irrestrito.</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-4 border-border brutalist-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 uppercase"><ShieldCheck className="w-6 h-6 text-primary" /> Status do Plano</CardTitle>
              <CardDescription>Resumo comercial e operacional do tenant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="p-4 bg-secondary border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground">Plano atual</div>
                  <div className="text-2xl font-bold uppercase">{subscription.planDisplayName || subscription.plan}</div>
                  <div className="text-sm text-primary font-semibold">R$ {subscription.monthlyPrice}/mês</div>
                </div>
                <div className="p-4 bg-secondary border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground">Status</div>
                  <Badge variant={subscription.status === "active" ? "default" : "destructive"} className="mt-2 uppercase">{subscription.status}</Badge>
                  <div className="text-sm mt-2">{subscription.isExpired ? "Acesso bloqueado até renovação" : `${subscription.daysRemaining} dia(s) restantes`}</div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="p-4 border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-2"><CreditCard className="w-4 h-4" /> Créditos/dia</div>
                  <div className="text-xl font-bold">{subscription.limits?.dailyCredits ?? 0}</div>
                </div>
                <div className="p-4 border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-2"><Send className="w-4 h-4" /> Limite por envio</div>
                  <div className="text-xl font-bold">{subscription.limits?.maxRecipientsPerSend ?? 0}</div>
                </div>
                <div className="p-4 border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-2"><Users className="w-4 h-4" /> Usuários no plano</div>
                  <div className="text-xl font-bold">até {subscription.limits?.maxUsers ?? 0}</div>
                </div>
              </div>

              {!subscription.isSuperAdmin ? (
                <div className="p-4 border-2 border-border">
                  <div className="text-xs uppercase text-muted-foreground flex items-center gap-2"><CreditCard className="w-4 h-4" /> Uso de créditos hoje</div>
                  <div className="mt-2 text-2xl font-bold">{usageToday?.creditsUsed ?? 0} / {usageToday?.limit ?? subscription.limits?.dailyCredits ?? 0}</div>
                  <div className="text-sm text-primary font-semibold mt-1">Restantes: {usageToday?.remaining ?? subscription.limits?.dailyCredits ?? 0}</div>
                </div>
              ) : null}

              <div className="p-4 border-2 border-dashed border-border">
                <div className="flex items-center gap-2 text-sm font-bold uppercase mb-2"><Calendar className="w-4 h-4" /> Vencimento</div>
                <div>
                  {subscription.subscriptionExpiresAt ? format(new Date(subscription.subscriptionExpiresAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "Sem vencimento"}
                </div>
                <div className="text-xs text-muted-foreground mt-2">Quando expira, o tenant passa automaticamente para status expirado e o acesso administrativo é bloqueado até renovação.</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-4 border-border brutalist-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 uppercase"><CreditCard className="w-6 h-6 text-primary" /> Cobrança</CardTitle>
              <CardDescription>Valores sugeridos para venda com Mercado Pago e PIX</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {(catalog?.plans || []).map((plan: any) => (
                  <div key={plan.id} className="border-2 border-border p-4">
                    <div className="font-bold uppercase">{plan.displayName}</div>
                    <div className="text-2xl font-black mt-1">R$ {plan.monthlyPrice}</div>
                    <div className="text-xs text-muted-foreground mt-1">{plan.dailyCredits} créditos/dia</div>
                    <div className="text-xs text-muted-foreground">até {plan.maxUsers} usuários</div>
                    <div className="text-xs text-muted-foreground">até {plan.maxRecipientsPerSend} por envio</div>
                  </div>
                ))}
              </div>
              <div className="p-4 border-2 border-border">
                <div className="font-bold uppercase mb-2">Créditos extras</div>
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  {(catalog?.extraCredits || []).map((pack: any) => (
                    <div key={pack.id} className="bg-secondary p-3 border border-border">
                      +{pack.credits} créditos — <span className="font-bold">R$ {pack.price}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">Integração real com Mercado Pago/PIX depende apenas de configurar a chave PIX e o link de checkout do seu tenant.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-4 border-border brutalist-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase"><Palette className="w-6 h-6 text-primary" /> White-label</CardTitle>
            <CardDescription>Personalize nome da marca, suporte e cobrança do tenant</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canWhiteLabelByPlan ? (
              <div className="p-4 border-2 border-yellow-500 bg-yellow-500/10 text-sm">White-label liberado automaticamente a partir do plano Pro.</div>
            ) : subscription?.isOwner || subscription?.isSuperAdmin ? (
              <div className="p-4 border-2 border-primary bg-primary/10 text-sm">Como owner, altere o branding na Área do Dono, pela gestão de tenants.</div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Input placeholder="Nome da marca" value={brandName} onChange={(e) => setBrandName(e.target.value)} disabled={!canEditWhiteLabel} />
              <Input placeholder="URL da logo" value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)} disabled={!canEditWhiteLabel} />
              <Input placeholder="Cor principal (#e11d48)" value={brandPrimaryColor} onChange={(e) => setBrandPrimaryColor(e.target.value)} disabled={!canEditWhiteLabel} />
              <Input placeholder="WhatsApp/suporte" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} disabled={!canEditWhiteLabel} />
              <Input placeholder="Chave PIX" value={pixKey} onChange={(e) => setPixKey(e.target.value)} disabled={!canEditWhiteLabel} />
              <Input placeholder="Link Mercado Pago" value={mercadoPagoLink} onChange={(e) => setMercadoPagoLink(e.target.value)} disabled={!canEditWhiteLabel} />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled={!canEditWhiteLabel || saveBranding.isPending} onClick={() => saveBranding.mutate({ brandName, brandLogoUrl, brandPrimaryColor, supportPhone, pixKey, mercadoPagoLink })}>Salvar white-label</Button>
              {pixKey ? <Button type="button" variant="outline" onClick={async () => { await navigator.clipboard.writeText(pixKey); toast.success("Chave PIX copiada"); }}><Copy className="w-4 h-4 mr-2" />Copiar PIX</Button> : null}
              {mercadoPagoLink ? <a href={mercadoPagoLink} target="_blank" rel="noreferrer" className="inline-flex items-center px-4 py-2 border-2 border-border hover:bg-secondary">Abrir checkout Mercado Pago</a> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
