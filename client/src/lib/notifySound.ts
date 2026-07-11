// client/src/lib/notifySound.ts
/**
 * Helper de som/alerta para "nova mensagem".
 *
 * Por que isso existe separado:
 * - Navegadores (especialmente Chrome/Android) bloqueiam o AudioContext até
 *   haver uma interação do usuário na página ("autoplay policy"). Se a gente
 *   cria um AudioContext novo e toca exatamente na hora que a mensagem
 *   chega, sem nunca ter sido "desbloqueado" antes por um toque/clique, o
 *   som pode simplesmente não saiu — sem nenhum erro aparecer no console.
 * - Por isso mantemos UM único AudioContext reaproveitado, e tentamos
 *   "destravar" ele (resume) no primeiro toque/clique/tecla do usuário.
 */

let ctx: AudioContext | null = null;
let unlockListenersAttached = false;

function getCtx(): AudioContext | null {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Chame uma vez (ex: no mount da tela de inbox). Registra listeners de
 * primeira interação do usuário para "destravar" o áudio com antecedência,
 * antes de qualquer notificação chegar. Idempotente — seguro chamar mais de
 * uma vez (só registra os listeners uma vez).
 */
export function primeNotificationAudio() {
  if (unlockListenersAttached) return;
  unlockListenersAttached = true;

  const tryResume = () => {
    const c = getCtx();
    if (c && c.state === "suspended") {
      c.resume().catch(() => {});
    }
  };

  window.addEventListener("pointerdown", tryResume, { once: true, passive: true });
  window.addEventListener("keydown", tryResume, { once: true });
}

/**
 * Toca um alerta sonoro de "nova mensagem" (dois tons curtos, tipo "ding-ding").
 * Bem mais audível que um beep único e baixo, mas ainda discreto.
 */
export async function playNewMessageSound() {
  try {
    const c = getCtx();
    if (!c) return;

    if (c.state === "suspended") {
      await c.resume().catch(() => {});
    }

    const now = c.currentTime;
    const tones = [
      { freq: 880, start: 0, dur: 0.13 },
      { freq: 1320, start: 0.15, dur: 0.16 },
    ];

    for (const t of tones) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;

      const startAt = now + t.start;
      const peakAt = startAt + 0.015;
      const endAt = startAt + t.dur;

      // envelope suave (evita "clique" de início/fim abrupto)
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, peakAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(gain);
      gain.connect(c.destination);

      osc.start(startAt);
      osc.stop(endAt + 0.02);
    }
  } catch {
    // som é um "extra" — nunca deve quebrar o fluxo de notificação
  }
}
