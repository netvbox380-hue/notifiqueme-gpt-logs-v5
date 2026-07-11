import "dotenv/config";

/**
 * Script para rodar os agendamentos manualmente (dev) chamando a API tRPC.
 *
 * Uso:
 *   npm run run:schedules
 *   npm run run:schedules -- --loop
 *   npm run run:schedules -- --loop --interval=60
 */

function getArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const loop = process.argv.includes("--loop");
const interval = Number(getArg("interval") ?? "60");
const baseUrl = (
  process.env.URL ||
  process.env.DEPLOY_URL ||
  process.env.DEPLOY_PRIME_URL ||
  process.env.NETLIFY_SITE_URL ||
  process.env.SITE_URL ||
  process.env.APP_URL ||
  "http://localhost:8888"
).replace(/\/$/, "");
const cronSecret = (process.env.CRON_SECRET || "").trim();

async function runOnce() {
  const url = `${baseUrl}/api/trpc/system.runSchedules?batch=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
    },
    body: JSON.stringify({ "0": { json: { limit: 50 } } }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[run-schedules] HTTP ${res.status}:`, text);
    process.exitCode = 1;
    return;
  }

  console.log(`[run-schedules] OK ${res.status}:`, text);
}

async function main() {
  await runOnce();

  if (!loop) return;

  if (!Number.isFinite(interval) || interval < 5) {
    console.error("[run-schedules] interval inválido. Use >= 5s. Ex: --interval=60");
    process.exit(1);
  }

  console.log(`[run-schedules] loop ativo a cada ${interval}s (APP_URL=${baseUrl})`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    await runOnce();
  }
}

main().catch((err) => {
  console.error("[run-schedules] erro:", err);
  process.exit(1);
});
