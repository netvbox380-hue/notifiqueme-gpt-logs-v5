import { useSyncExternalStore } from "react";
import { registerServiceWorker } from "@/lib/pwa-register";

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
    throw new Error("Service Worker indisponível para push neste ambiente.");
  }

  await navigator.serviceWorker.ready;
  return registration;
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
    throw new Error("Push não suportado neste navegador");
  }

  if (Notification.permission === "denied") {
    throw new Error(
      "Notificações bloqueadas. Libere nas permissões do navegador.",
    );
  }

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      notifyPushStatusChanged();
      throw new Error("Permissão de notificação não concedida.");
    }
  }

  const existingSubscription = await findExistingPushSubscription();
  if (existingSubscription) {
    notifyPushStatusChanged();
    return existingSubscription;
  }

  const registration = await ensureServiceWorker();

  if (!publicKey.trim()) {
    throw new Error("VAPID public key ausente");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
      .buffer as ArrayBuffer,
  });

  notifyPushStatusChanged();
  return subscription;
}

export async function unsubscribePush(): Promise<boolean> {
  if (!hasBrowserEnvironment() || !("serviceWorker" in navigator)) return false;

  const registration = await findServiceWorkerRegistration();
  if (!registration) return false;

  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const unsubscribed = subscription ? await subscription.unsubscribe() : false;

  notifyPushStatusChanged();
  return unsubscribed;
}

async function findExistingPushSubscription(): Promise<PushSubscription | null> {
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
  // embora o registro esteja ficando pronto. Usa ready como última tentativa.
  try {
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("service-worker-ready-timeout")), 5000),
      ),
    ]);
    return await readyRegistration.pushManager.getSubscription();
  } catch {
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
  pushStatusSnapshot = nextStatus;
  emitPushStatus();
}

async function refreshGlobalPushStatus(): Promise<PushStatus> {
  // Compartilha uma leitura em andamento entre todos os componentes.
  if (pushStatusRefreshPromise) return pushStatusRefreshPromise;

  const requestId = ++pushStatusRequestId;
  pushStatusRefreshPromise = readPushStatus()
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
