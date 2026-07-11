import type { Handler } from "@netlify/functions";
import { schedule } from "@netlify/functions";
import { resolveSiteBaseUrl } from "./_cron-helpers";

/**
 * Netlify Scheduled Function: executa os agendamentos (recorrência) chamando
 * o endpoint tRPC `system.runSchedules`.
 *
 * - Produção: roda automaticamente conforme o schedule abaixo.
 * - Dev (netlify dev): NÃO roda automaticamente, mas você pode chamar manualmente
 *   via script `npm run run:schedules` (incluído no package.json).
 */
const handlerImpl: Handler = async () => {
  const baseUrl = resolveSiteBaseUrl();

  if (!baseUrl) {
    return {
      statusCode: 500,
      body: "Missing base URL (URL/DEPLOY_PRIME_URL/APP_URL).",
    };
  }

  const cronSecret = (process.env.CRON_SECRET || "").trim();

  const url = `${baseUrl}/api/trpc/system.runSchedules?batch=1`;

  console.log("[cron-run-schedules] invoking", { baseUrl, hasCronSecret: !!cronSecret, url });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
    },
    // limita a quantidade por execução (ajuste se necessário)
    body: JSON.stringify({ "0": { json: { limit: 50 } } }),
  });

  const text = await res.text();
  return {
    statusCode: res.status,
    body: text,
  };
};

// A cada 1 minuto (Netlify limita menor que 1min em alguns planos).
export const handler = schedule("@every 1m", handlerImpl);
