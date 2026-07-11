import { useSyncExternalStore } from "react";
import { registerServiceWorker } from "@/lib/pwa-register";
import { writeDiagnosticLog } from "@/lib/diagnostics";

const PUSH_STATUS_EVENT = "notifique-me:push-status-changed";

export type PushStatus =
  | "checking"
  | "unsupported"
  | "ios-needs-install"
  | "denied"
  | "not-subscribed"
  | "active";

function hasBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function supportsPush(): boolean {
  return (
    hasBrowserEnvironment() &&
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isIosDevice(): boolean {
  return (
    hasBrowserEnvironment() && /iphone|ipad|ipod/i.test(navigator.userAgent)
  );
}

function assertSecureContext(): void {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (window.location.protocol !== "https:" && !isLocalhost) {
    throw new Error(
      "Push só funciona em HTTPS ou localhost. Abra pelo domínio HTTPS publicado para ativar notificações.",
    );
  }
}

// ✅ Ponto único de espera pelo Service Worker — NUNCA sem limite de tempo.
// Esse era exatamente o bug: `ensureServiceWorker()` fazia
// `await navigator.serviceWorker.ready` sem prazo, e se o SW nunca ativasse
// de verdade (erro no sw.js, instalação travada, cenário raro de TWA), a
// cadeia inteira (readPushStatus → refreshGlobalPushStatus → usePushStatus)
// ficava pendurada pra sempre — a tela nunca saía de "Verificando
// notificações…". Com o timeout, o pior caso é degradar pra um estado
// conhecido (não trava), e o motivo fica registrado no log de diagnóstico.
const SERVICE_WORKER_READY_TIMEOUT_MS = 6000;

async function waitForServiceWorkerReady(
  timeoutMs = SERVICE_WORKER_READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration | null> {
  try {
    const result = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => {
        window.setTimeout(() => {
          writeDiagnosticLog(
            "warn",
            "push-status",
            `serviceWorker.ready não respondeu em ${timeoutMs}ms — seguindo sem travar a interface`,
          );
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    return result;
  } catch (error) {
    writeDiagnosticLog("error", "push-status", "serviceWorker.ready rejeitou", error);
    return null;
  }
}

async function findServiceWorkerRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.getRegistration()) ??
    undefined
  );
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!hasBrowserEnvironment() || !("serviceWorker" in navigator)) {
    throw new Error("Service Worker não suportado");
  }

  assertSecureContext();

  let registration = await findServiceWorkerRegistration();
  if (!registration) {
    registration = (await registerServiceWorker()) ?? undefined;
  }

  if (!registration) {
    writeDiagnosticLog("error", "push-status", "Nenhum Service Worker disponível para registrar push");
    throw new Error("Service Worker indisponível para push neste ambiente.");
  }

  // ✅ Corrigido: antes era `await navigator.serviceWorker.ready` sem prazo
  // (a causa da trava em "Verificando notificações…"). Agora, se não ficar
  // "ready" a tempo, seguimos com o registration que já temos em mãos —
  // normalmente já é suficiente pra checar/criar uma subscription mesmo
  // "installing"/"waiting" — em vez de travar a interface pra sempre.
  const readyRegistration = await waitForServiceWorkerReady();
  return readyRegistration ?? registration;
}

export function refreshPushStatus(): void {
  if (!hasBrowserEnvironment()) return;
  // Invalida leituras anteriores e atualiza a fonte global imediatamente.
  pushStatusRequestId += 1;
  pushStatusRefreshPromise = null;
  setPushStatusSnapshot("checking");
  void refreshGlobalPushStatus();
  window.dispatchEvent(new Event(PUSH_STATUS_EVENT));
}

function notifyPushStatusChanged(): void {
  refreshPushStatus();
}

export function isStandaloneMode(): boolean {
  if (!hasBrowserEnvironment()) return false;

  const iosStandalone = Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone,
  );
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;

  return iosStandalone || displayModeStandalone;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

export async function getOrCreatePushSubscription(
  publicKey: string,
): Promise<PushSubscription> {
  if (!supportsPush()) {
    writeDiagnosticLog("warn", "push-status", "Tentativa de ativar push em navegador sem suporte");
    throw new Error("Push não suportado neste navegador");
  }

  if (Notification.permission === "denied") {
    writeDiagnosticLog("warn", "push-status", "Ativação bloqueada: permissão negada pelo usuário/navegador");
    throw new Error(
      "Notificações bloqueadas. Libere nas permissões do navegador.",
    );
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    writeDiagnosticLog("info", "push-status", `Permissão de notificação solicitada: ${permission}`);
    if (permission !== "granted") {
      notifyPushStatusChanged();
      throw new Error("Permissão de notificação não concedida.");
    }
  }

  const existingSubscription = await findExistingPushSubscription();
  if (existingSubscription) {
    writeDiagnosticLog("info", "push-status", "Subscription já existente reutilizada");
    notifyPushStatusChanged();
    return existingSubscription;
  }

  const registration = await ensureServiceWorker();

  if (!publicKey.trim()) {
    writeDiagnosticLog("error", "push-status", "VAPID public key ausente ao tentar assinar push");
    throw new Error("VAPID public key ausente");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
      .buffer as ArrayBuffer,
  });

  writeDiagnosticLog("info", "push-status", "Nova subscription de push criada com sucesso");
  notifyPushStatusChanged();
  return subscription;
}

export async function unsubscribePush(): Promise<boolean> {
  if (!hasBrowserEnvironment() || !("serviceWorker" in navigator)) return false;

  const registration = await findServiceWorkerRegistration();
  if (!registration) return false;

  await waitForServiceWorkerReady();
  const subscription = await registration.pushManager.getSubscription();
  const unsubscribed = subscription ? await subscription.unsubscribe() : false;

  writeDiagnosticLog("info", "push-status", unsubscribed ? "Push cancelado pelo usuário" : "Nenhuma subscription ativa para cancelar");
  notifyPushStatusChanged();
  return unsubscribed;
}

export async function findExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!hasBrowserEnvironment() || !("serviceWorker" in navigator)) return null;

  // O Android/TWA pode manter mais de um registration durante a troca de
  // versão do Service Worker. Consultar somente getRegistration("/") pode
  // pegar o registro novo, ainda sem subscription, enquanto a subscription
  // válida continua ligada ao registro ativo anterior.
  const registrations = await navigator.serviceWorker.getRegistrations();

  for (const registration of registrations) {
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) return subscription;
    } catch {
      // Continua procurando nos demais registros.
    }
  }

  // Em uma primeira carga pode não haver item em getRegistrations() ainda,
  // embora o registro esteja ficando pronto. Usa o mesmo helper com prazo
  // como última tentativa (nunca espera pra sempre).
  const readyRegistration = await waitForServiceWorkerReady();
  if (!readyRegistration) return null;

  try {
    return await readyRegistration.pushManager.getSubscription();
  } catch (error) {
    writeDiagnosticLog("warn", "push-status", "Falha ao consultar subscription após ready", error);
    return null;
  }
}

async function readPushStatus(): Promise<PushStatus> {
  if (isIosDevice() && !isStandaloneMode()) return "ios-needs-install";
  if (!supportsPush()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "not-subscribed";

  try {
    // Primeiro procura a subscription já existente sem registrar/atualizar o
    // SW. Atualizar o worker durante uma simples leitura de status criava uma
    // janela de corrida no reload e fazia o banner enxergar o registro novo
    // sem subscription.
    const existingSubscription = await findExistingPushSubscription();
    if (existingSubscription) return "active";

    // Só garante o registro quando realmente não encontrou nenhum registro
    // utilizável. Depois verifica de novo em todos os registrations.
    await ensureServiceWorker();
    const subscriptionAfterRegistration = await findExistingPushSubscription();
    return subscriptionAfterRegistration ? "active" : "not-subscribed";
  } catch {
    return "not-subscribed";
  }
}

// Fonte global única. Banner, menu e qualquer outra tela observam exatamente
// o mesmo snapshot, evitando estados contraditórios após reload.
let pushStatusSnapshot: PushStatus = "checking";
let pushStatusRequestId = 0;
let pushStatusRefreshPromise: Promise<PushStatus> | null = null;
const pushStatusListeners = new Set<() => void>();

function emitPushStatus(): void {
  for (const listener of pushStatusListeners) listener();
}

function setPushStatusSnapshot(nextStatus: PushStatus): void {
  if (pushStatusSnapshot === nextStatus) return;
  const previous = pushStatusSnapshot;
  pushStatusSnapshot = nextStatus;
  writeDiagnosticLog("info", "push-status", `Status do push mudou: ${previous} → ${nextStatus}`);
  emitPushStatus();
}

async function refreshGlobalPushStatus(): Promise<PushStatus> {
  // Compartilha uma leitura em andamento entre todos os componentes.
  if (pushStatusRefreshPromise) return pushStatusRefreshPromise;

  const requestId = ++pushStatusRequestId;
  // ✅ Segunda camada de segurança (redundante, de propósito): mesmo com os
  // pontos internos já protegidos por timeout, essa é uma garantia por fora
  // de que a checagem inteira NUNCA passa de 10s sem resolver pra algo — se
  // isso disparar, é sinal de um novo `await` sem prazo escondido em algum
  // lugar, e fica registrado como erro crítico no log em vez de travar a UI
  // silenciosamente pra sempre.
  pushStatusRefreshPromise = Promise.race([
    readPushStatus(),
    new Promise<PushStatus>((resolve) => {
      window.setTimeout(() => {
        writeDiagnosticLog(
          "error",
          "push-status",
          "readPushStatus() não resolveu em 10s mesmo com os timeouts internos — degradando pra 'not-subscribed'. Isso indica um novo ponto sem prazo; vale investigar.",
        );
        resolve("not-subscribed");
      }, 10_000);
    }),
  ])
    .then((nextStatus) => {
      // Uma resposta antiga nunca pode sobrescrever uma verificação mais nova.
      if (requestId === pushStatusRequestId) {
        setPushStatusSnapshot(nextStatus);
      }
      return nextStatus;
    })
    .finally(() => {
      if (requestId === pushStatusRequestId) {
        pushStatusRefreshPromise = null;
      }
    });

  return pushStatusRefreshPromise;
}

function subscribeToPushStatus(listener: () => void): () => void {
  pushStatusListeners.add(listener);
  if (pushStatusListeners.size === 1 && hasBrowserEnvironment()) {
    void refreshGlobalPushStatus();
  }
  return () => pushStatusListeners.delete(listener);
}

function getPushStatusSnapshot(): PushStatus {
  return pushStatusSnapshot;
}

function getServerPushStatusSnapshot(): PushStatus {
  return "checking";
}

let globalStatusEventsInstalled = false;

function installGlobalPushStatusEvents(): void {
  if (!hasBrowserEnvironment() || globalStatusEventsInstalled) return;
  globalStatusEventsInstalled = true;

  const refresh = () => void refreshGlobalPushStatus();
  const refreshWhenVisible = () => {
    if (!document.hidden) refresh();
  };

  window.addEventListener(PUSH_STATUS_EVENT, refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  navigator.serviceWorker?.addEventListener?.("controllerchange", refresh);
}

export function usePushStatus(): PushStatus {
  installGlobalPushStatusEvents();
  return useSyncExternalStore(
    subscribeToPushStatus,
    getPushStatusSnapshot,
    getServerPushStatusSnapshot,
  );
}
