import React from "react";
import { Bell, ShieldAlert, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushStatus } from "@/lib/push";

type Props = {
  // Chamado quando o usuário clica na ação do banner. O ideal é abrir o
  // menu/painel onde o InstallAppButton já vive — reaproveita o fluxo de
  // ativação/instalação existente em vez de duplicá-lo aqui.
  onAction: () => void;
};

// ✅ Banner persistente (fica visível até o push realmente ficar ativo,
// diferente do modal explicativo que só aparece uma vez por dispositivo).
// Não pede permissão nem cria subscription sozinho — só informa e direciona
// para a ação certa, usando o estado real do navegador (usePushStatus).
export default function PushActivationBanner({ onAction }: Props) {
  const status = usePushStatus();

  // "checking": ainda detectando, evita flash de banner desnecessário.
  // "active": push já funcionando, nada a fazer.
  // "unsupported": navegador não suporta push — nenhuma ação resolveria isso.
  if (status === "checking" || status === "active" || status === "unsupported") {
    return null;
  }

  const content: Record<
    Exclude<typeof status, "checking" | "active" | "unsupported">,
    { icon: React.ReactNode; title: string; description: string; cta: string }
  > = {
    "ios-needs-install": {
      icon: <Smartphone className="w-4 h-4" />,
      title: "Instale o app para receber notificações",
      description:
        "No iPhone/iPad, o Safari só entrega notificações depois que o app é adicionado à Tela de Início.",
      cta: "Ver como instalar",
    },
    denied: {
      icon: <ShieldAlert className="w-4 h-4" />,
      title: "Notificações bloqueadas no navegador",
      description:
        "Você bloqueou as notificações antes. Libere manualmente nas permissões do navegador e recarregue a página.",
      cta: "Ver instruções",
    },
    "not-subscribed": {
      icon: <Bell className="w-4 h-4" />,
      title: "Ative as notificações",
      description: "Sem isso, você só vê os avisos quando abre o app manualmente.",
      cta: "Ativar agora",
    },
  };

  const info = content[status];

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-4">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 shrink-0 text-amber-500">{info.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{info.title}</div>
          <div className="text-xs text-muted-foreground">{info.description}</div>
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onAction}>
        {info.cta}
      </Button>
    </div>
  );
}
