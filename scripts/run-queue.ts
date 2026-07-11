/*
  Worker simples para processar a fila (job_queue).
  - Útil para alta escala (rodar separado do cron)

  Uso:
    npm run run:queue
    npm run run:queue -- --loop --interval=5
*/

import "dotenv/config";
import { processJobs } from "../server/_core/queue";

function parseArgs() {
  const args = process.argv.slice(2);
  const loop = args.includes("--loop");
  const intervalIdx = args.findIndex((a) => a === "--interval");
  const interval =
    intervalIdx >= 0 ? Number(args[intervalIdx + 1] || "5") : 5;
  return { loop, interval };
}

async function once() {
  const r = await processJobs({ limit: 200 });
  console.log(`[run-queue] OK: processed=${r.processed}`);
}

async function main() {
  const { loop, interval } = parseArgs();
  if (!loop) return once();

  console.log(`[run-queue] loop mode (interval=${interval}s)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await once();
    } catch (e) {
      console.error("[run-queue] error", e);
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
