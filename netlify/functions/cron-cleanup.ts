import type { Handler } from "@netlify/functions";
import { schedule } from "@netlify/functions";
import { resolveSiteBaseUrl } from "./_cron-helpers";

/**
 * Netlify Scheduled Function: limpeza automática semanal
 * - Chama o endpoint tRPC `system.cleanupOldMessages`
 * - Mantém o banco leve em escala (mensagens antigas)
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
  const retentionDays = Number(process.env.CLEANUP_RETENTION_DAYS || "30");

  const url = `${baseUrl}/api/trpc/system.cleanupOldMessages?batch=1`;

  console.log("[cron-cleanup] invoking", { baseUrl, hasCronSecret: !!cronSecret, retentionDays, url });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
    },
    body: JSON.stringify({
      "0": {
        json: {
          retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30,
          batchSize: 2000,
          maxBatches: 5,
        },
      },
    }),
  });

  const text = await res.text();
  return { statusCode: res.status, body: text };
};

// semanal
export const handler = schedule("@weekly", handlerImpl);
