import { z } from "zod";
import webpush from "web-push";
import { router, protectedProcedure } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { pushSubscriptions } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function ensureVapid() {
  const pub = ENV.vapidPublicKey;
  const priv = ENV.vapidPrivateKey;
  const subj = ENV.vapidSubject || "mailto:admin@notifique-me.local";

  if (!pub || !priv) return false;

  webpush.setVapidDetails(subj, pub, priv);
  return true;
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB indisponível",
    });
  }
  return db;
}

function isExpiredSubscription(error: unknown): boolean {
  const candidate = error as { statusCode?: unknown; status?: unknown; body?: unknown; message?: unknown };
  const statusCode = Number(candidate?.statusCode ?? candidate?.status ?? 0);
  if (statusCode === 404 || statusCode === 410) return true;
  const message = String(candidate?.body ?? candidate?.message ?? error ?? "").toLowerCase();
  return ["expired", "not registered", "unsubscribe", "invalid token"].some((term) => message.includes(term));
}

async function safeSendAndPrune(db: Awaited<ReturnType<typeof requireDb>>, subscription: typeof pushSubscriptions.$inferSelect, payload: string) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      { urgency: "high", TTL: 300 }
    );
    return { ok: true as const };
  } catch (error) {
    const expired = isExpiredSubscription(error);
    if (expired) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, subscription.userId), eq(pushSubscriptions.endpoint, subscription.endpoint)))
        .catch(() => undefined);
    }
    return {
      ok: false as const,
      expired,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const pushRouter = router({
  publicKey: protectedProcedure.query(() => {
    return { publicKey: ENV.vapidPublicKey || "" };
  }),

  diagnostics: protectedProcedure
    .input(z.object({ endpoint: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          userAgent: pushSubscriptions.userAgent,
          updatedAt: pushSubscriptions.updatedAt,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, ctx.user.id));

      const normalizedEndpoint = input.endpoint?.trim() || null;
      const matching = normalizedEndpoint
        ? rows.filter((row) => row.endpoint === normalizedEndpoint)
        : [];

      const maskEndpoint = (endpoint: string) =>
        endpoint.length > 44
          ? `${endpoint.slice(0, 28)}…${endpoint.slice(-12)}`
          : endpoint;

      const result = {
        checkedAt: new Date().toISOString(),
        userId: ctx.user.id,
        tenantId: ctx.user.tenantId ?? null,
        authenticated: true,
        vapidConfigured: Boolean(ENV.vapidPublicKey && ENV.vapidPrivateKey),
        vapidSubjectConfigured: Boolean(ENV.vapidSubject),
        subscriptionsInDatabase: rows.length,
        endpointProvided: Boolean(normalizedEndpoint),
        endpointMatched: matching.length > 0,
        subscriptions: rows.map((row) => ({
          id: row.id,
          endpoint: maskEndpoint(row.endpoint),
          userAgent: row.userAgent || null,
          updatedAt: row.updatedAt || null,
          matchesCurrentDevice: Boolean(normalizedEndpoint && row.endpoint === normalizedEndpoint),
        })),
      };

      console.info("[PUSH DIAGNOSTICS]", {
        userId: result.userId,
        tenantId: result.tenantId,
        vapidConfigured: result.vapidConfigured,
        subscriptionsInDatabase: result.subscriptionsInDatabase,
        endpointMatched: result.endpointMatched,
      });

      return result;
    }),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().min(1),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
        userAgent: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb(); // ✅ FIX
      const userId = ctx.user.id;

      console.info("[PUSH SUBSCRIBE] iniciando", {
        userId,
        tenantId: ctx.user.tenantId ?? null,
        endpoint: input.endpoint.length > 44
          ? `${input.endpoint.slice(0, 28)}…${input.endpoint.slice(-12)}`
          : input.endpoint,
      });

      await db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
          updatedAt: new Date(),
        } as any)
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent,
            updatedAt: new Date(),
          } as any,
        });

      console.info("[PUSH SUBSCRIBE] subscription salva", {
        userId,
        tenantId: ctx.user.tenantId ?? null,
      });

      return { success: true, syncedAt: new Date().toISOString() };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb(); // ✅ FIX
      const userId = ctx.user.id;

      await db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, input.endpoint))
        );

      return { success: true };
    }),

  /**
   * Teste de push
   */
  test: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ensureVapid()) {
      return { success: false, error: "VAPID não configurado" };
    }

    const db = await requireDb(); // ✅ FIX

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id));

    if (!subs.length) {
      return { success: false, error: "Usuário sem subscription" };
    }

    const payload = JSON.stringify({
      title: "Notifique-me",
      body: "Push funcionando ✅",
      url: "/my-notifications",
      // ✅ ajuda a testar contador no ícone (Android/Chrome)
      badgeCount: 1,
      ts: Date.now(),
    });

    console.info("[PUSH TEST] envio iniciado", {
      userId: ctx.user.id,
      subscriptions: subs.length,
    });

    const results = await Promise.all(subs.map((s: any) => safeSendAndPrune(db, s, payload)));

    const sent = results.filter((result) => result.ok).length;
    const failures = results.filter((result) => !result.ok);

    console.info("[PUSH TEST] resultado", {
      userId: ctx.user.id,
      sent,
      total: subs.length,
      failures: failures.length,
    });

    return {
      success: sent > 0,
      sent,
      total: subs.length,
      expiredRemoved: failures.filter((result) => "expired" in result && result.expired).length,
      errors: failures.map((result) => ("error" in result ? result.error : "Falha desconhecida")),
    };
  }),
});
