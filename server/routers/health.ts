
import { router, ownerOnlyProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { jobQueue } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

export const healthRouter = router({
  status: ownerOnlyProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { ok: false, queue: { queued: 0, processing: 0, failed: 0 }, lastFailure: null };
    }

    const rows = await db
      .select({
        queued: sql<number>`sum(case when ${jobQueue.status} = 'queued' then 1 else 0 end)`,
        processing: sql<number>`sum(case when ${jobQueue.status} = 'processing' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${jobQueue.status} = 'failed' then 1 else 0 end)`,
      })
      .from(jobQueue);

    const lastFailed = await db
      .select({ id: jobQueue.id, lastError: jobQueue.lastError, updatedAt: jobQueue.updatedAt })
      .from(jobQueue)
      .where(eq(jobQueue.status, "failed"))
      .orderBy(sql`${jobQueue.updatedAt} DESC`)
      .limit(1);

    return {
      ok: true,
      queue: {
        queued: Number(rows?.[0]?.queued ?? 0),
        processing: Number(rows?.[0]?.processing ?? 0),
        failed: Number(rows?.[0]?.failed ?? 0),
      },
      lastFailure: lastFailed?.[0] ?? null,
    };
  }),
});
