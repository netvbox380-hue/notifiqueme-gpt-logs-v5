import "dotenv/config";

function getArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const retentionDays = Number(getArg("retentionDays") ?? process.env.CLEANUP_RETENTION_DAYS ?? "30");
const batchSize = Number(getArg("batchSize") ?? process.env.CLEANUP_BATCH_SIZE ?? "2000");
const maxBatches = Number(getArg("maxBatches") ?? process.env.CLEANUP_MAX_BATCHES ?? "5");
const baseUrl = (
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.URL ||
  process.env.DEPLOY_URL ||
  process.env.DEPLOY_PRIME_URL ||
  process.env.NETLIFY_SITE_URL ||
  process.env.SITE_URL ||
  "http://127.0.0.1:3000"
).replace(/\/$/, "");
const cronSecret = (process.env.CRON_SECRET || "").trim();

async function main() {
  const url = `${baseUrl}/api/trpc/system.cleanupOldMessages?batch=1`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cronSecret ? { "x-cron-secret": cronSecret } : {}),
    },
    body: JSON.stringify({
      0: {
        json: { retentionDays, batchSize, maxBatches },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[run-cleanup] HTTP ${res.status}:`, text);
    process.exit(1);
  }

  console.log(`[run-cleanup] OK ${res.status}:`, text);
}

main().catch((err) => {
  console.error("[run-cleanup] erro:", err);
  process.exit(1);
});
