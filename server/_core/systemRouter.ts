import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db";
import {
  schedules,
  notifications,
  deliveries,
  users,
  userGroups,
  groups,
} from "../../drizzle/schema";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkAndConsumeCredits } from "./credits";
import { getTenantStatusInfo } from "./tenantAccess";
import { ENV } from "./env";
import { enqueueJob, processJobs } from "./queue";
import { createScheduleAdminAlert } from "./adminAlerts";

/**
 * systemRouter
 * health + readiness + execução automática de recorrência (com push)
 */

/**
 * 🔒 Protege endpoints de CRON (runSchedules / cleanupOldMessages).
 *
 * Regras:
 * - Se CRON_SECRET está configurada: exige o header x-cron-secret correto (sempre, prod ou dev).
 * - Se CRON_SECRET NÃO está configurada:
 *   - Em produção: RECUSA a chamada (fail-closed). Evita que esses endpoints fiquem
 *     publicamente abertos por esquecimento de configuração no host de deploy.
 *   - Em desenvolvimento: permite (para não travar `npm run run:schedules` local).
 */
function assertCronSecretOrThrow(ctx: any) {
  const expected = (ENV.cronSecret || "").trim();

  if (!expected) {
    if (ENV.isProduction) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "CRON_SECRET não configurado. Defina a variável de ambiente CRON_SECRET para habilitar este endpoint em produção.",
      });
    }
    return; // dev sem secret: permite
  }

  const got = String(ctx.req.headers["x-cron-secret"] ?? "").trim();
  if (!got || got !== expected) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "CRON secret inválido" });
  }
}

function addRecurrence(base: Date, recurrence: "none" | "hourly" | "daily" | "weekly" | "monthly" | "yearly") {
  const next = new Date(base);
  if (recurrence === "hourly") next.setHours(next.getHours() + 1);
  if (recurrence === "daily") next.setDate(next.getDate() + 1);
  if (recurrence === "weekly") next.setDate(next.getDate() + 7);
  if (recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  if (recurrence === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

function coerceDate(value: unknown, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

async function resolveScheduleRecipientIds(db: any, schedule: any) {
  const creatorRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, Number(schedule.createdBy)))
    .limit(1);

  const creatorRole = String(creatorRows[0]?.role || "admin");
  const isOwner = creatorRole === "owner";
  const actorId = Number(schedule.createdBy);

  if (schedule.targetType === "all") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        isOwner
          ? and(eq(users.tenantId, schedule.tenantId), eq(users.role, "user"))
          : and(eq(users.tenantId, schedule.tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId))
      );
    return rows.map((r: any) => Number(r.id));
  }

  if (schedule.targetType === "users") {
    const ids = ((schedule.targetIds ?? []) as number[]).filter((n) => Number.isFinite(Number(n))).map(Number);
    if (!ids.length) return [];
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        isOwner
          ? and(eq(users.tenantId, schedule.tenantId), eq(users.role, "user"), inArray(users.id, ids))
          : and(eq(users.tenantId, schedule.tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId), inArray(users.id, ids))
      );
    return rows.map((r: any) => Number(r.id));
  }

  const groupIds = ((schedule.targetIds ?? []) as number[]).filter((n) => Number.isFinite(Number(n))).map(Number);
  if (!groupIds.length) return [];

  if (isOwner) {
    const members = await db
      .select({ userId: userGroups.userId })
      .from(userGroups)
      .innerJoin(users, eq(users.id, userGroups.userId))
      .where(
        and(
          inArray(userGroups.groupId, groupIds),
          eq(users.tenantId, schedule.tenantId),
          eq(users.role, "user")
        )
      );
    return Array.from(new Set(members.map((m: any) => Number(m.userId)).filter((n) => Number.isFinite(n))));
  }

  const members = await db
    .select({ userId: userGroups.userId })
    .from(userGroups)
    .innerJoin(users, eq(users.id, userGroups.userId))
    .where(
      and(
        inArray(userGroups.groupId, groupIds),
        eq(users.tenantId, schedule.tenantId),
        eq(users.role, "user"),
        eq(users.createdByAdminId, actorId)
      )
    );

  return Array.from(new Set(members.map((m: any) => Number(m.userId)).filter((n) => Number.isFinite(n))));
}

// Push de schedules agora é processado via fila (job_queue).
// (o envio fica centralizado em server/_core/push.ts)

async function executeSchedules(limit: number) {
  const db = await getDb();
  if (!db) return { executed: 0, processedJobs: 0 };

  const now = new Date();

  // ✅ usa nextRunAt (fallback pra scheduledFor)
  const dueAt = sql`COALESCE(${schedules.nextRunAt}, ${schedules.scheduledFor})`;
  // Evita enviar Date JS como parâmetro em expressão SQL crua com postgres-js.
  // Para colunas timestamp do Drizzle usamos Date; para este filtro usamos NOW() do banco.
  const dueNow = sql`${dueAt} <= NOW()`;
  const staleProcessingCutoff = new Date(Date.now() - 10 * 60 * 1000);

  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.isActive, true), dueNow))
    .orderBy(dueAt)
    .limit(limit);

  let executed = 0;

  for (const s of due as any[]) {
    const lastRunAt = coerceDate(s.lastRunAt, new Date(0));
    const isFreshProcessing = s.lastRunStatus === "processing" && lastRunAt.getTime() > staleProcessingCutoff.getTime();
    if (isFreshProcessing) continue;

    const claimed = await db
      .update(schedules)
      .set({
        lastRunStatus: "processing",
        lastRunAt: now as any,
        lastRunMessage: null,
      })
      .where(
        and(
          eq(schedules.id, s.id),
          eq(schedules.isActive, true),
          dueNow
        )
      )
      .returning({ id: schedules.id });

    if (!claimed[0]?.id) continue;

    const userIds = await resolveScheduleRecipientIds(db, s);

    // Mesmo sem destinatários, avança a recorrência para não travar em loop infinito
    if (!userIds.length) {
      const base = coerceDate(s.nextRunAt ?? s.scheduledFor, now);
      if (s.recurrence === "none") {
      await db
        .update(schedules)
        .set({ isActive: false, lastExecutedAt: now as any, lastRunAt: now as any, lastRunStatus: "failed", lastRunMessage: "Nenhum destinatário válido encontrado", lastTargetCount: 0, lastSuccessCount: 0, lastFailureCount: 0, nextRunAt: null })
          .where(eq(schedules.id, s.id));
      } else {
        await db
          .update(schedules)
          .set({
            nextRunAt: addRecurrence(base, s.recurrence) as any,
            lastExecutedAt: now as any,
            lastRunAt: now as any,
            lastRunStatus: "failed",
            lastRunMessage: "Nenhum destinatário válido encontrado",
            lastTargetCount: 0,
            lastSuccessCount: 0,
            lastFailureCount: 0,
          })
          .where(eq(schedules.id, s.id));
      }
      await createScheduleAdminAlert({
        db,
        scheduleId: Number(s.id),
        creatorId: Number(s.createdBy),
        tenantId: Number(s.tenantId),
        scheduleTitle: String(s.title || `Agendamento #${s.id}`),
        status: "failed",
        message: "Nenhum destinatário válido encontrado",
        targetCount: 0,
        successCount: 0,
        failureCount: 0,
        notificationId: Number(s.lastNotificationId || 0) || null,
        scheduledFor: s.scheduledFor ?? s.nextRunAt ?? null,
        executedAt: now,
      });
      continue;
    }

    const base = coerceDate(s.nextRunAt ?? s.scheduledFor, now);

    try {
      const tenantInfo = await getTenantStatusInfo(Number(s.tenantId));
      if (tenantInfo.effectiveStatus === "expired") {
        throw new Error("Plano expirado. Renove a assinatura para reativar os agendamentos.");
      }
      if (tenantInfo.effectiveStatus === "suspended") {
        throw new Error("Tenant suspenso. Regularize o plano para reativar os agendamentos.");
      }

      await checkAndConsumeCredits({ tenantId: Number(s.tenantId), cost: userIds.length });
    } catch (err: any) {
      const failMessage = String(err?.message || err || "Falha ao consumir créditos do agendamento").slice(0, 500);
      if (s.recurrence === "none") {
        await db
          .update(schedules)
          .set({
            isActive: false,
            lastExecutedAt: now as any,
            lastRunAt: now as any,
            lastRunStatus: "failed",
            lastRunMessage: failMessage,
            lastTargetCount: userIds.length,
            lastSuccessCount: 0,
            lastFailureCount: userIds.length,
            nextRunAt: null,
          })
          .where(eq(schedules.id, s.id));
      } else {
        await db
          .update(schedules)
          .set({
            nextRunAt: addRecurrence(base, s.recurrence) as any,
            lastExecutedAt: now as any,
            lastRunAt: now as any,
            lastRunStatus: "failed",
            lastRunMessage: failMessage,
            lastTargetCount: userIds.length,
            lastSuccessCount: 0,
            lastFailureCount: userIds.length,
          })
          .where(eq(schedules.id, s.id));
      }
      await createScheduleAdminAlert({
        db,
        scheduleId: Number(s.id),
        creatorId: Number(s.createdBy),
        tenantId: Number(s.tenantId),
        scheduleTitle: String(s.title || `Agendamento #${s.id}`),
        status: "failed",
        message: failMessage,
        targetCount: userIds.length,
        successCount: 0,
        failureCount: userIds.length,
        notificationId: Number(s.lastNotificationId || 0) || null,
        scheduledFor: s.scheduledFor ?? s.nextRunAt ?? null,
        executedAt: now,
      });
      continue;
    }

    // Cria a notification (agendada)
    const inserted = await db
      .insert(notifications)
      .values({
        tenantId: s.tenantId,
        title: s.title,
        content: s.content,
        priority: s.priority,
        createdBy: s.createdBy,
        targetType: s.targetType,
        targetIds: s.targetIds,
        imageUrl: s.imageUrl,
        scheduleId: s.id,
        isScheduled: true,
        // PgTimestamp espera Date
        createdAt: now as any,
        isActive: true,
      } as any)
      .returning({ id: notifications.id });

    const notificationId = inserted[0]?.id;
    if (!notificationId) continue;

    await db
      .update(schedules)
      .set({
        lastRunAt: now as any,
        lastRunStatus: "processing",
        lastRunMessage: "Mensagem programada em processamento",
        lastNotificationId: notificationId,
        lastTargetCount: userIds.length,
        lastSuccessCount: 0,
        lastFailureCount: 0,
      })
      .where(eq(schedules.id, s.id));

    // Enfileira para processamento (DB queue) e evita duplicados por execução paralela.
    // Observação: a UI e o restante do sistema continuam funcionando mesmo sem worker dedicado,
    // porque a própria execução do cron processa uma parte da fila inline.
    const runKey = coerceDate(s.nextRunAt ?? s.scheduledFor, now).toISOString();
    await enqueueJob({
      type: "dispatch_notification",
      payload: { notificationId, userIds },
      runAt: new Date(),
      dedupeKey: `schedule:${s.id}:run:${runKey}`,
    });

    executed++;

    // Recorrência: baseia em nextRunAt se existir
    if (s.recurrence === "none") {
      await db
        .update(schedules)
        .set({ isActive: false, lastExecutedAt: now as any, nextRunAt: null })
        .where(eq(schedules.id, s.id));
    } else {
      await db
        .update(schedules)
        .set({
          // PgTimestamp espera Date
          nextRunAt: addRecurrence(base, s.recurrence) as any,
          lastExecutedAt: now as any,
        })
        .where(eq(schedules.id, s.id));
    }
  }

  const { processed } = await processJobs({ limit: 100 });
  return { executed, processedJobs: processed };
}

export const systemRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
    time: Date.now(),
  })),

  ready: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { ok: false };
    return { ok: true };
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return { success: delivered };
    }),

  /**
   * 🔥 endpoint chamado por CRON (Render)
   */
  runSchedules: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .mutation(async ({ ctx, input }) => {
      // 🔒 fail-closed em produção (ver assertCronSecretOrThrow)
      assertCronSecretOrThrow(ctx);

      const r = await executeSchedules(input?.limit ?? 50);
      return { success: true, executed: r.executed, processedJobs: r.processedJobs };
    }),

  /**
   * Limpeza automática (CRON): remove notifications/deliveries antigos
   * - Protegido por CRON_SECRET
   * - Em lotes para não travar o banco
   */
  cleanupOldMessages: publicProcedure
    .input(
      z
        .object({
          retentionDays: z.number().min(1).max(3650).default(30),
          batchSize: z.number().min(100).max(5000).default(2000),
          maxBatches: z.number().min(1).max(10).default(5),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      // 🔒 fail-closed em produção (ver assertCronSecretOrThrow)
      assertCronSecretOrThrow(ctx);

      const db = await getDb();
      if (!db) return { success: false, deletedNotifications: 0, deletedDeliveries: 0, done: true };

      const retentionDays = input?.retentionDays ?? 30;
      const batchSize = input?.batchSize ?? 2000;
      const maxBatches = input?.maxBatches ?? 5;

      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      let deletedNotifications = 0;
      let deletedDeliveries = 0;
      let batches = 0;
      let done = false;

      while (batches < maxBatches) {
        batches++;
        const idsRows = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(sql`${notifications.createdAt} < ${cutoff as any}`)
          .orderBy(sql`${notifications.id} ASC`)
          .limit(batchSize);

        const ids = (idsRows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
        if (!ids.length) {
          done = true;
          break;
        }

        await db.delete(deliveries).where(inArray(deliveries.notificationId, ids));
        await db.delete(notifications).where(inArray(notifications.id, ids));

        deletedNotifications += ids.length;
      }

      return { success: true, deletedNotifications, deletedDeliveries, batches, done };
    }),
});