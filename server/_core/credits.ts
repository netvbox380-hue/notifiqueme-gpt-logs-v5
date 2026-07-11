
import { TRPCError } from "@trpc/server";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { tenants, tenantDailyUsage } from "../../drizzle/schema";
import { PLANS, PlanId } from "./plans";

function utcDay(d = new Date()) {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

export async function getTenantPlanLimits(tenantId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const t = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const plan = (t?.[0]?.plan ?? "basic") as PlanId;
  const limits = PLANS[plan] ?? PLANS.basic;

  return { plan, limits };
}

export async function getCreditsUsageToday(tenantId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const day = utcDay();
  const rows = await db
    .select({ creditsUsed: tenantDailyUsage.creditsUsed })
    .from(tenantDailyUsage)
    .where(sql`${tenantDailyUsage.tenantId} = ${tenantId} AND ${tenantDailyUsage.day} = ${day}`)
    .limit(1);

  return { day, creditsUsed: Number(rows?.[0]?.creditsUsed ?? 0) };
}

/**
 * Checks and consumes credits atomically.
 * - cost = number of deliveries that will be created
 */
export async function checkAndConsumeCredits(params: {
  tenantId: number;
  cost: number;
}) {
  const { tenantId, cost } = params;
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Custo inválido" });
  }

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const { limits, plan } = await getTenantPlanLimits(tenantId);
  const day = utcDay();

  // Ensure row exists
  await db.execute(sql`
    INSERT INTO tenant_daily_usage ("tenantId", day, "creditsUsed", "updatedAt")
    VALUES (${tenantId}, ${day}, 0, NOW())
    ON CONFLICT ("tenantId", day) DO NOTHING
  `);

  // Attempt atomic update with guard
  const updated = await db.execute(sql`
    UPDATE tenant_daily_usage
    SET "creditsUsed" = "creditsUsed" + ${cost}, "updatedAt" = NOW()
    WHERE "tenantId" = ${tenantId}
      AND day = ${day}
      AND ("creditsUsed" + ${cost}) <= ${limits.dailyCredits}
    RETURNING "creditsUsed"
  `);

  // drizzle-orm/postgres-js may return rows as an array directly (postgres.js RowList)
  // or as an object with `.rows` depending on the runtime adapter.
  const firstRow = (updated as any)?.[0] ?? (updated as any)?.rows?.[0];
  const newUsed = Number(firstRow?.creditsUsed ?? NaN);

  if (!Number.isFinite(newUsed)) {
    // get current used for message
    const cur = await getCreditsUsageToday(tenantId);
    const remaining = Math.max(0, limits.dailyCredits - cur.creditsUsed);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Limite diário de créditos excedido. Restante hoje: ${remaining}.`,
    });
  }

  return {
    allowed: true,
    plan,
    day,
    used: newUsed,
    limit: limits.dailyCredits,
    remaining: Math.max(0, limits.dailyCredits - newUsed),
  };
}
