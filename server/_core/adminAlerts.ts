import { and, eq } from "drizzle-orm";
import { deliveries, notifications, schedules, users } from "../../drizzle/schema";
import { sendPushToUsers } from "./push";

export type AdminAlertStatus = "sent" | "failed" | "partial" | "processing";

function formatWhen(value: unknown) {
  const d = value ? new Date(value as any) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

function buildStatusLabel(status: AdminAlertStatus) {
  if (status === "sent") return "enviado com sucesso";
  if (status === "partial") return "concluído parcialmente";
  if (status === "processing") return "em processamento";
  return "falhou";
}

export async function createScheduleAdminAlert(params: {
  db: any;
  scheduleId: number;
  creatorId: number;
  tenantId: number;
  scheduleTitle: string;
  status: AdminAlertStatus;
  message?: string | null;
  targetCount?: number | null;
  successCount?: number | null;
  failureCount?: number | null;
  notificationId?: number | null;
  scheduledFor?: Date | string | null;
  executedAt?: Date | string | null;
}) {
  const db = params.db;
  const creatorId = Number(params.creatorId);
  if (!Number.isFinite(creatorId)) return null;

  const creator = await db
    .select({ id: users.id, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);

  if (!creator[0]?.id) return null;

  const statusLabel = buildStatusLabel(params.status);
  const executedAtText = formatWhen(params.executedAt) || "agora";
  const scheduledForText = formatWhen(params.scheduledFor);
  const baseTitle =
    params.status === "failed"
      ? `Falha no agendamento: ${params.scheduleTitle}`
      : params.status === "partial"
        ? `Agendamento parcial: ${params.scheduleTitle}`
        : params.status === "processing"
          ? `Agendamento iniciado: ${params.scheduleTitle}`
          : `Agendamento enviado: ${params.scheduleTitle}`;

  const lines = [
    `O agendamento \"${params.scheduleTitle}\" foi ${statusLabel}.`,
    scheduledForText ? `Programado para: ${scheduledForText}.` : null,
    `Executado em: ${executedAtText}.`,
    `Alvos: ${Number(params.targetCount || 0)} • Sucesso: ${Number(params.successCount || 0)} • Falha: ${Number(params.failureCount || 0)}.`,
    params.notificationId ? `Mensagem vinculada #${Number(params.notificationId)}.` : null,
    params.message ? `Detalhe: ${String(params.message).slice(0, 1000)}` : null,
  ].filter(Boolean);

  const inserted = await db
    .insert(notifications)
    .values({
      tenantId: Number(params.tenantId),
      title: baseTitle.slice(0, 255),
      content: lines.join("\n"),
      priority: params.status === "failed" || params.status === "partial" ? "important" : "normal",
      createdBy: creatorId,
      targetType: "users",
      targetIds: [creatorId],
      isScheduled: false,
      scheduledFor: null,
      recurrence: "none",
      scheduleId: Number(params.scheduleId),
      isActive: true,
      createdAt: new Date(),
    } as any)
    .returning({ id: notifications.id });

  const adminNotificationId = Number(inserted[0]?.id || 0);
  if (!adminNotificationId) return null;

  await db
    .insert(deliveries)
    .values({
      tenantId: Number(params.tenantId),
      notificationId: adminNotificationId,
      userId: creatorId,
      status: "delivered",
      deliveredAt: new Date(),
      isRead: false,
      errorMessage: params.status === "failed" ? String(params.message || "Falha no agendamento").slice(0, 5000) : null,
    } as any)
    .onConflictDoNothing({
      target: [deliveries.tenantId, deliveries.notificationId, deliveries.userId],
    });

  try {
    await sendPushToUsers({
      tenantId: Number(params.tenantId),
      userIds: [creatorId],
      title: baseTitle.slice(0, 120),
      content: lines[0] as string,
      notificationId: adminNotificationId,
    });
  } catch {
    // inbox já foi criada; não quebra o fluxo administrativo
  }

  return adminNotificationId;
}

export async function syncScheduleAdminAlert(params: {
  db: any;
  scheduleId: number;
  creatorId: number;
  tenantId: number;
  scheduleTitle: string;
  status: AdminAlertStatus;
  message?: string | null;
  targetCount?: number | null;
  successCount?: number | null;
  failureCount?: number | null;
  notificationId?: number | null;
  scheduledFor?: Date | string | null;
  executedAt?: Date | string | null;
}) {
  const db = params.db;
  const scheduleId = Number(params.scheduleId);
  if (!Number.isFinite(scheduleId)) return null;

  const scheduleRows = await db
    .select({
      id: schedules.id,
      lastNotificationId: schedules.lastNotificationId,
      lastRunStatus: schedules.lastRunStatus,
      lastRunAt: schedules.lastRunAt,
      lastRunMessage: schedules.lastRunMessage,
    })
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), eq(schedules.tenantId, Number(params.tenantId))))
    .limit(1);

  const schedule = scheduleRows[0];
  const meta = {
    ...params,
    notificationId: params.notificationId ?? schedule?.lastNotificationId ?? null,
    message: params.message ?? schedule?.lastRunMessage ?? null,
    executedAt: params.executedAt ?? schedule?.lastRunAt ?? null,
  };

  return createScheduleAdminAlert(meta);
}
