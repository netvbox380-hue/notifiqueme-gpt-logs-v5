import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Info, Bell, BellRing, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  getOrCreatePushSubscription,
  isStandaloneMode,
  refreshPushStatus,
  usePushStatus,
} from "@/lib/push";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// ✅ Guardas em nível de módulo (sobrevivem a remounts do componente — ex:
// navegar entre páginas do painel admin recria o InstallAppButton, mas isso
// NÃO deve reiniciar o auto-prompt/auto-resubscribe). Resetam só em reload
// completo da página, o que é o comportamento desejado.
let autoPushSessionAttempted = false;
let autoPushSessionInFlight = false;

// ✅ isStandaloneMode agora vive em @/lib/push (fonte única, compartilhada
// com o hook usePushStatus usado no banner de ativação).

export default function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  // ✅ Push state compartilhado com o banner (fonte única de verdade)
  const pushStatus = usePushStatus();
  const pushReady = pushStatus === "active";
  const pushChecking = pushStatus === "checking";
  const [pushSynced, setPushSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPermissionExplainer, setShowPermissionExplainer] = useState(false);

  const utils = trpc.useUtils();
  const publicKeyQuery = trpc.push.publicKey.useQuery(undefined, {
    staleTime: 60_000,
  });

  const subscribeMutation = trpc.push.subscribe.useMutation();
  const testMutation = trpc.push.test.useMutation();

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    // ✅ se já está instalado/standalone, não mostrar (mantém seu comportamento)
    setInstalled(isStandaloneMode());
    setDeferred(((window as any).__nmBeforeInstallPrompt as BeforeInstallPromptEvent | undefined) || null);

    // ✅ Evita oferecer instalação duplicada: se o usuário acessa o site pelo
    // navegador normal (não pelo app), mas já tem o app TWA instalado pela
    // Play Store, a API getInstalledRelatedApps() detecta isso (com base na
    // declaração "related_applications" do manifest.json) e escondemos o
    // botão de instalar — reaproveitando o mesmo estado/lógica que já existe
    // pra "já está instalado".
    if (typeof (navigator as any).getInstalledRelatedApps === "function") {
      (navigator as any)
        .getInstalledRelatedApps()
        .then((apps: Array<{ platform: string; id?: string }>) => {
          const hasTwaInstalled = apps.some(
            (a) => a.platform === "play" && a.id === "work.notifique_me.twa"
          );
          if (hasTwaInstalled) setInstalled(true);
        })
        .catch(() => {});
    }

    const handler = (e: Event) => {
      (window as any).__nmBeforeInstallPrompt = e;
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    const installedHandler = () => {
      setInstalled(true);
      setDeferred(null);
      try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    // ✅ detecta mudança de display-mode
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;

    const mqHandler = () => setInstalled(isStandaloneMode());
    // @ts-ignore compat
    mq?.addEventListener?.("change", mqHandler);
    // @ts-ignore compat
    mq?.addListener?.(mqHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
      // @ts-ignore compat
      mq?.removeEventListener?.("change", mqHandler);
      // @ts-ignore compat
      mq?.removeListener?.(mqHandler);
    };
  }, []);

  // ✅ detecta se já existe subscription local
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!("serviceWorker" in navigator)) return;
        const reg =
          (await navigator.serviceWorker.getRegistration("/")) ||
          (await navigator.serviceWorker.getRegistration());
        if (!reg) return;

        await reg.pushManager.getSubscription();
        if (!cancelled) refreshPushStatus();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const cls = "gap-2 w-full sm:w-auto";

  // ✅ Ativar notificações (cria subscription + salva no backend)
  // silent=true: usado no auto-prompt pós-login — evita alert() bloqueante
  // e nunca mostra erro (ex: usuário fechou o prompt do navegador), só
  // fica quieto e deixa o botão manual disponível pra tentar de novo depois.
  const enablePush = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    try {
      setBusy(true);

      const publicKey = publicKeyQuery.data?.publicKey || "";
      if (!publicKey) {
        if (!silent) alert("Push não configurado: VAPID public key vazia.");
        return;
      }

      const sub = await getOrCreatePushSubscription(publicKey);

      const json = sub.toJSON() as any;

      await subscribeMutation.mutateAsync({
        endpoint: String(json.endpoint),
        keys: {
          p256dh: String(json.keys?.p256dh || ""),
          auth: String(json.keys?.auth || ""),
        },
        userAgent: navigator.userAgent,
      });

      setPushSynced(true);
      refreshPushStatus();

      // ✅ sincroniza contador (badge) logo após habilitar
      try {
        await utils.notifications.inboxCount.invalidate();
      } catch {}

      // ✅ só avisa o usuário na PRIMEIRA ativação de verdade. Chamadas
      // silenciosas seguintes (ex: remount do componente ao navegar entre
      // páginas, com a permissão já concedida) são apenas "garantir que a
      // inscrição existe no backend" — idempotentes e não devem gerar toast
      // nem qualquer alerta repetido.
      let alreadyActivatedBefore = false;
      try {
        alreadyActivatedBefore = localStorage.getItem("nm_push_activated_once") === "1";
      } catch {}

      if (!alreadyActivatedBefore) {
        try {
          localStorage.setItem("nm_push_activated_once", "1");
        } catch {}

        if (silent) {
          toast.success("Notificações ativadas");
        } else {
          alert("Notificações ativadas ✅");
        }
      } else if (!silent) {
        // clique manual no botão sempre dá feedback, mesmo que já tivesse ativado antes
        alert("Notificações ativadas ✅");
      }
    } catch (e: any) {
      // silencioso: não assusta o usuário logo após o login (ex: ele
      // dispensou o prompt do navegador). O botão manual continua disponível.
      if (!silent) {
        alert(String(e?.message ?? e ?? "Falha ao ativar notificações"));
      }
    } finally {
      setBusy(false);
    }
  };

  // ✅ Auto-prompt pós-login: pede a permissão de notificação automaticamente
  // assim que o usuário entra no app, em vez de depender dele lembrar de
  // clicar em "Ativar notificações" no menu.
  // - Só pergunta UMA vez por dispositivo/navegador (guarda em localStorage),
  //   pra não ficar repetindo o pedido a cada login.
  // - Se a permissão já foi negada antes, não tenta de novo (o navegador
  //   nem mostraria o prompt — só voltaria "denied" direto).
  // - Se a permissão já está concedida mas falta só a inscrição (ex: cache
  //   limpo), tenta resolver isso silenciosamente, sem precisar de prompt.
  const autoPromptAttemptedRef = useRef(false);

  useEffect(() => {
    // Mesmo com subscription local existente, sincroniza novamente com o backend
    // após cada reload/sessão autenticada. A subscription do navegador pode existir
    // enquanto o registro correspondente no banco foi removido ou ficou vinculado
    // a outro usuário.
    if (pushSynced) return;
    // ✅ guarda de sessão (sobrevive a remounts do componente ao navegar
    // entre páginas do painel) — evita repetir o auto-resubscribe/aviso.
    if (autoPushSessionAttempted || autoPushSessionInFlight) return;
    if (autoPromptAttemptedRef.current) return;
    if (!publicKeyQuery.data?.publicKey) return;
    if (typeof Notification === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    if (Notification.permission === "denied") return;

    if (Notification.permission === "granted") {
      // já tem permissão, só falta a inscrição -> resolve sem perguntar nada
      // (silencioso e, na prática, sem efeito visível quando a inscrição já
      // existe — getOrCreatePushSubscription reaproveita a subscription
      // existente em vez de criar/repetir o backend call de forma ruidosa).
      autoPromptAttemptedRef.current = true;
      autoPushSessionAttempted = true;
      autoPushSessionInFlight = true;
      void enablePush({ silent: true }).finally(() => {
        autoPushSessionInFlight = false;
      });
      return;
    }

    // Notification.permission === "default": mostra explicação primeiro.
    // O pedido real ao navegador só acontece quando o usuário clica em
    // "Ativar" no modal — isso conta como gesto explícito dele, o que
    // melhora a taxa de aceite e evita o navegador tratar o pedido como
    // "de baixa qualidade" (alguns navegadores penalizam prompts pedidos
    // sem nenhum contexto/interação).
    let already = false;
    try {
      already = localStorage.getItem("nm_auto_push_asked") === "1";
    } catch {}
    if (already) {
      autoPushSessionAttempted = true;
      return;
    }

    autoPromptAttemptedRef.current = true;
    autoPushSessionAttempted = true;
    setShowPermissionExplainer(true);
  }, [pushSynced, publicKeyQuery.data?.publicKey]);

  // ✅ Chamado pelo botão "Ativar" do modal explicativo — esse clique É o
  // gesto do usuário que autoriza o navegador a mostrar o prompt nativo.
  const confirmEnableFromExplainer = () => {
    try {
      localStorage.setItem("nm_auto_push_asked", "1");
    } catch {}
    setShowPermissionExplainer(false);
    void enablePush({ silent: true });
  };

  // ✅ Usuário disse "agora não" — não insiste de novo automaticamente,
  // mas o botão manual "Ativar notificações" continua disponível sempre.
  const dismissExplainer = () => {
    try {
      localStorage.setItem("nm_auto_push_asked", "1");
    } catch {}
    setShowPermissionExplainer(false);
  };

  const testPush = async () => {
    try {
      setBusy(true);
      const res = await testMutation.mutateAsync();
      if ((res as any)?.success === false) {
        alert((res as any)?.error || "Falha no teste");
        return;
      }
      alert("Teste enviado ✅ (veja se apareceu notificação e badge)");
    } catch (e: any) {
      alert(String(e?.message ?? e ?? "Falha no teste"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* =========================
          MODAL EXPLICATIVO (antes do prompt nativo do navegador)
         ========================= */}
      <Dialog open={showPermissionExplainer} onOpenChange={(open) => { if (!open) dismissExplainer(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Ativar notificações
            </DialogTitle>
            <DialogDescription>
              Ative para receber avisos importantes — você só será notificado
              quando algo relevante for enviado pra você. Pode desativar
              quando quiser nas configurações do dispositivo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={dismissExplainer}>
              Agora não
            </Button>
            <Button onClick={confirmEnableFromExplainer}>
              <Bell className="w-4 h-4" />
              Ativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =========================
          BOTÕES DE PUSH (sempre úteis)
         ========================= */}
      {pushChecking ? (
        <Button variant="outline" className={cls} disabled>
          <Bell className="w-4 h-4" />
          Verificando notificações…
        </Button>
      ) : !pushReady ? (
        <Button
          variant="outline"
          className={cls}
          disabled={busy || publicKeyQuery.isLoading}
          onClick={() => void enablePush()}
        >
          <Bell className="w-4 h-4" />
          {busy ? "Ativando…" : "Ativar notificações"}
        </Button>
      ) : (
        <Button
          variant="outline"
          className={cls}
          disabled={busy}
          onClick={testPush}
        >
          <BellRing className="w-4 h-4" />
          {busy ? "Enviando…" : "Testar push"}
        </Button>
      )}

      {/* =========================
          INSTALAÇÃO PWA
          - Se já está instalado/standalone, escondemos apenas a parte de instalação.
          - Mantemos Push (ativar/testar) sempre visível.
         ========================= */}
      {!installed ? (
        deferred ? (
          <Button
            variant="outline"
            className={cls}
            onClick={async () => {
              try {
                await deferred.prompt();
                const choice = await deferred.userChoice;
                if (choice.outcome === "accepted") {
                  setDeferred(null);
                  try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
                }
              } catch {
                // se falhar, mantém fallback
                setDeferred(null);
                try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
              }
            }}
          >
            <Download className="w-4 h-4" />
            Instalar app
          </Button>
        ) : isIos ? (
          <Button
            variant="outline"
            className={cls}
            onClick={() =>
              alert(
                "Para instalar no iPhone/iPad:\n\n1) Toque em Compartilhar\n2) 'Adicionar à Tela de Início'"
              )
            }
          >
            <Download className="w-4 h-4" />
            Como instalar
          </Button>
        ) : (
          <Button
            variant="outline"
            className={cls}
            onClick={() =>
              alert(
                "Se o botão 'Instalar app' não aparecer automaticamente:\n\n1) Abra no Chrome\n2) Menu ⋮ → 'Instalar app' / 'Adicionar à tela inicial'\n3) Recarregue a página e navegue um pouco\n\nObs: se você já dispensou o prompt antes, ele pode não aparecer automaticamente."
              )
            }
          >
            <Info className="w-4 h-4" />
            Como instalar
          </Button>
        )
      ) : null}
    </div>
  );
}
