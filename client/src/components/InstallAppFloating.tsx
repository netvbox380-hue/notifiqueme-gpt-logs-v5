import React, { useEffect, useMemo, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneMode() {
  const iosStandalone = typeof window !== "undefined" && Boolean((navigator as any).standalone);
  const mqStandalone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || mqStandalone;
}

function isMobileDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

export default function InstallAppFloating() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [openHelp, setOpenHelp] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const sync = () => {
      setInstalled(isStandaloneMode());
      setIsMobile(isMobileDevice());
      const ua = navigator.userAgent.toLowerCase();
      setIsIos(/iphone|ipad|ipod/.test(ua));
      setPromptEvent(((window as any).__nmBeforeInstallPrompt as BeforeInstallPromptEvent | undefined) || null);
    };

    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__nmBeforeInstallPrompt = e;
      setPromptEvent(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
    };

    sync();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("resize", sync);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const visible = useMemo(() => isMobile && !installed, [isMobile, installed]);
  if (!visible) return null;

  return (
    <>
      <div className="fixed bottom-4 left-4 right-4 z-[60] md:hidden">
        {promptEvent ? (
          <Button
            className="w-full h-12 text-base font-semibold shadow-2xl"
            onClick={async () => {
              try {
                await promptEvent.prompt();
                await promptEvent.userChoice;
                setPromptEvent(null);
                try { delete (window as any).__nmBeforeInstallPrompt; } catch {}
              } catch {}
            }}
          >
            <Download className="w-5 h-5 mr-2" />
            Instalar app
          </Button>
        ) : (
          <Button variant="outline" className="w-full h-12 text-base font-semibold bg-background/95" onClick={() => setOpenHelp((v) => !v)}>
            <Smartphone className="w-5 h-5 mr-2" />
            Como instalar app
          </Button>
        )}
      </div>

      {openHelp ? (
        <div className="fixed inset-x-4 bottom-20 z-[60] rounded-2xl border bg-background p-4 shadow-2xl md:hidden">
          <div className="text-sm font-semibold mb-2">Instalar aplicativo</div>
          <div className="text-xs text-muted-foreground leading-5">
            {isIos
              ? 'No iPhone/iPad, toque em Compartilhar e depois em Adicionar à Tela de Início.'
              : 'No Chrome, use o botão Instalar app quando aparecer. Se não aparecer, abra o menu do navegador e escolha Instalar aplicativo.'}
          </div>
        </div>
      ) : null}
    </>
  );
}
