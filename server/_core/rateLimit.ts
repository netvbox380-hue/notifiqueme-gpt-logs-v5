
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

function now() {
  return Date.now();
}

function getIp(req: any) {
  const xf = req?.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return (
    req?.ip ||
    req?.socket?.remoteAddress ||
    (req?.connection && req.connection.remoteAddress) ||
    "unknown"
  );
}

function buildKey(params: { req: any; key: string; scope?: string | number | null }) {
  const ip = getIp(params.req);
  const scope = String(params.scope ?? "").trim();
  return scope ? `${params.key}:${ip}:${scope}` : `${params.key}:${ip}`;
}

function assertTooManyRequests(resetAt: number) {
  const seconds = Math.max(1, Math.ceil((resetAt - now()) / 1000));
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Muitas requisições. Tente novamente em ${seconds}s.`,
  });
}

function assertRateLimitMemory(params: {
  req: any;
  key: string;
  limit: number;
  windowMs: number;
  scope?: string | number | null;
}) {
  const k = buildKey(params);
  const t = now();
  const e = buckets.get(k);

  if (!e || t >= e.resetAt) {
    buckets.set(k, { count: 1, resetAt: t + params.windowMs });
    return;
  }

  e.count += 1;
  if (e.count > params.limit) {
    assertTooManyRequests(e.resetAt);
  }
}

export async function assertRateLimit(params: {
  req: any;
  key: string;
  limit: number;
  windowMs: number;
  scope?: string | number | null;
}) {
  const k = buildKey(params);
  const t = now();
  const resetAt = new Date(t + params.windowMs);

  try {
    const db = await getDb();
    if (!db) {
      assertRateLimitMemory(params);
      return;
    }

    const existingRes: any = await db.execute(sql`
      SELECT "count", "resetAt"
      FROM "rate_limits"
      WHERE "key" = ${k}
      LIMIT 1
    `);
    const existingRows = existingRes?.rows ?? existingRes ?? [];
    const existing = existingRows[0] as { count?: number; resetAt?: Date | string } | undefined;

    if (!existing || !existing.resetAt || new Date(existing.resetAt).getTime() <= t) {
      await db.execute(sql`
        INSERT INTO "rate_limits" ("key", "count", "resetAt", "updatedAt")
        VALUES (${k}, 1, ${resetAt}, NOW())
        ON CONFLICT ("key") DO UPDATE
        SET "count" = 1,
            "resetAt" = ${resetAt},
            "updatedAt" = NOW()
      `);
      return;
    }

    const currentCount = Number(existing.count ?? 0) + 1;
    const currentResetAt = new Date(existing.resetAt).getTime();

    await db.execute(sql`
      UPDATE "rate_limits"
      SET "count" = ${currentCount},
          "updatedAt" = NOW()
      WHERE "key" = ${k}
    `);

    if (currentCount > params.limit) {
      assertTooManyRequests(currentResetAt);
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.warn("[RateLimit] fallback para memória:", error);
    assertRateLimitMemory(params);
  }
}
