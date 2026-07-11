import { z } from "zod";
import { router, adminOnlyProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { schedules, notifications, deliveries, logs } from "../../drizzle/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * CRUD de schedules (executor do cron fica em system.runSchedules)
 */

function requireTenant(ctx: any): number {
  const t = ctx.user?.tenantId;
  if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
  return t;
}

function resolveScheduleTenant(ctx: any, tenantId?: number | null): number {
  if (ctx.user?.role === "owner") {
    if (!tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "tenantId é obrigatório (owner deve informar)" });
    return Number(tenantId);
  }
  return requireTenant(ctx);
}

async function deleteScheduleById(db: any, tenantId: number, id: number) {
  await db
    .delete(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
}

export const schedulesRouter = router({
  /**
   * Criar agendamento
   */
  create: adminOnlyProcedure
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        priority: z.enum(["normal", "important", "urgent"]).default("normal"),
        targetType: z.enum(["all", "users", "groups"]),
        targetIds: z.array(z.number()).default([]),
        imageUrl: z.string().optional(),
        scheduledFor: z.date(),
        recurrence: z.enum(["none", "hourly", "daily", "weekly", "monthly", "yearly"]).default("none"),
        tenantId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);

      const nextRunAt = input.scheduledFor;

      const result = await db
        .insert(schedules)
        .values({
          tenantId,
          title: input.title,
          content: input.content,
          priority: input.priority,
          createdBy: ctx.user.id,
          targetType: input.targetType,
          targetIds: input.targetIds,
          imageUrl: input.imageUrl,
          scheduledFor: input.scheduledFor,
          recurrence: input.recurrence,
          nextRunAt,
          isActive: true,
        } as any)
        .returning({ id: schedules.id });

      return { success: true, id: result[0].id };
    }),

  /**
   * Listar agendamentos
   * ✅ compat: aceita {limit} OU sem input
   */
  list: adminOnlyProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100), tenantId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input?.tenantId);
      const whereClause = ctx.user?.role === "owner"
        ? and(eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id)))
        : eq(schedules.tenantId, tenantId);

      const data = await db
        .select()
        .from(schedules)
        .where(whereClause as any)
        .orderBy(sql`${schedules.id} DESC`)
        .limit(input?.limit ?? 100);

      const totalRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(schedules)
        .where(whereClause as any);

      return { data, total: Number(totalRows?.[0]?.count ?? 0) };
    }),

  /**
   * Ativar / desativar
   */
  toggle: adminOnlyProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean(), tenantId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);
      const whereClause = ctx.user?.role === "owner"
        ? and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id)))
        : and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId));

      await db
        .update(schedules)
        .set({ isActive: input.isActive })
        .where(whereClause as any);

      return { success: true };
    }),

  /**
   * Atualizar agendamento (editar em qualquer circunstância)
   * - Permite editar mesmo após execução
   * - Por padrão, ao salvar volta para ATIVO e recalcula nextRunAt
   */
  update: adminOnlyProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1),
        content: z.string().min(1),
        priority: z.enum(["normal", "important", "urgent"]).default("normal"),
        targetType: z.enum(["all", "users", "groups"]),
        targetIds: z.array(z.number()).default([]),
        imageUrl: z.string().optional(),
        scheduledFor: z.date(),
        recurrence: z.enum(["none", "hourly", "daily", "weekly", "monthly", "yearly"]).default("none"),
        // opcional: se quiser salvar como pausado
        isActive: z.boolean().optional(),
        tenantId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);
      const whereClause = ctx.user?.role === "owner"
        ? and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id)))
        : and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId));

      const found = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(whereClause as any)
        .limit(1);

      if (!found.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agendamento não encontrado" });
      }

      const nextRunAt = input.scheduledFor;

      await db
        .update(schedules)
        .set({
          title: input.title,
          content: input.content,
          priority: input.priority,
          targetType: input.targetType,
          targetIds: input.targetIds,
          imageUrl: input.imageUrl,
          scheduledFor: input.scheduledFor,
          recurrence: input.recurrence,
          nextRunAt,
          isActive: input.isActive ?? true,
        } as any)
        .where(whereClause as any);

      return { success: true };
    }),


  timeline: adminOnlyProcedure
    .input(z.object({ id: z.number(), tenantId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);
      const whereClause = ctx.user?.role === "owner"
        ? and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id)))
        : and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId));

      const scheduleRow = await db
        .select()
        .from(schedules)
        .where(whereClause as any)
        .limit(1);

      if (!scheduleRow.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agendamento não encontrado" });
      }

      const schedule = scheduleRow[0] as any;
      const items: any[] = [
        {
          type: "created",
          at: schedule.createdAt || schedule.scheduledFor,
          title: "Agendamento criado",
          description: `Recorrência: ${String(schedule.recurrence || "none")}`,
        },
      ];

      if (schedule.lastRunAt) {
        items.push({
          type: String(schedule.lastRunStatus || "processing"),
          at: schedule.lastRunAt,
          title: `Última execução: ${String(schedule.lastRunStatus || "processando").toUpperCase()}`,
          description: schedule.lastRunMessage || null,
        });
      }

      if (schedule.lastNotificationId) {
        const notif = await db
          .select({ id: notifications.id, title: notifications.title, createdAt: notifications.createdAt })
          .from(notifications)
          .where(and(eq(notifications.id, schedule.lastNotificationId), eq(notifications.tenantId, tenantId)))
          .limit(1);

        const deliverySummary = await db
          .select({
            delivered: sql<number>`count(*)::int`,
            read: sql<number>`count(case when ${deliveries.isRead} = true then 1 end)::int`,
            failed: sql<number>`count(case when ${deliveries.status} = 'failed' then 1 end)::int`,
          })
          .from(deliveries)
          .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.notificationId, schedule.lastNotificationId)));

        items.push({
          type: "notification",
          at: notif?.[0]?.createdAt || schedule.lastRunAt || schedule.scheduledFor,
          title: notif?.[0]?.title || `Mensagem #${schedule.lastNotificationId}`,
          description: `Envios: ${Number(deliverySummary?.[0]?.delivered ?? 0)} • Lidas: ${Number(deliverySummary?.[0]?.read ?? 0)} • Falhas: ${Number(deliverySummary?.[0]?.failed ?? 0)}`,
          notificationId: schedule.lastNotificationId,
        });
      }

      const logRows = await db
        .select({ id: logs.id, action: logs.action, details: logs.details, createdAt: logs.createdAt })
        .from(logs)
        .where(and(eq(logs.tenantId, tenantId), eq(logs.entityType, "schedule"), eq(logs.entityId, input.id)))
        .orderBy(desc(logs.createdAt))
        .limit(20);

      for (const row of logRows as any[]) {
        items.push({
          type: "log",
          at: row.createdAt,
          title: row.action || "LOG",
          description: row.details || null,
          logId: row.id,
        });
      }

      items.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
      return { schedule, items };
    }),

  /**
   * Delete
   */
  delete: adminOnlyProcedure
    .input(z.object({ id: z.number(), tenantId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);

      if (ctx.user?.role === "owner") {
        await db.delete(schedules).where(and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id))));
      } else {
        await deleteScheduleById(db, tenantId, input.id);
      }

      return { success: true };
    }),

  /**
   * Remove (compat)
   */
  remove: adminOnlyProcedure
    .input(z.object({ id: z.number(), tenantId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = resolveScheduleTenant(ctx, input.tenantId);

      if (ctx.user?.role === "owner") {
        await db.delete(schedules).where(and(eq(schedules.id, input.id), eq(schedules.tenantId, tenantId), eq(schedules.createdBy, Number(ctx.user.id))));
      } else {
        await deleteScheduleById(db, tenantId, input.id);
      }

      return { success: true };
    }),
});