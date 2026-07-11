import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { jobQueue, notifications, pushSubscriptions, deliveries, schedules, users, userGroups, groups } from "../../drizzle/schema";
import { sendPushToUsers } from "./push";
import { syncScheduleAdminAlert } from "./adminAlerts";

export type JobType = "dispatch_notification";

export type DispatchNotificationPayload = {
  notificationId: number;
  userIds?: number[];
};

function now() {
  return new Date();
}

function safeJsonParse<T>(s: string): T {
  return JSON.parse(s) as T;
}

/**
 * Enqueue a job. If dedupeKey is provided, it will be used to avoid duplicates.
 */
export async function enqueueJob(params: {
  type: JobType;
  payload: unknown;
  runAt?: Date;
  dedupeKey?: string;
}) {
  const db = await getDb();
  const payloadStr = JSON.stringify(params.payload ?? {});

  try {
    await db.insert(jobQueue).values({
      type: params.type,
      payload: payloadStr,
      runAt: params.runAt ?? now(),
      dedupeKey: params.dedupeKey,
    });
  } catch (e: any) {
    // Dedupe hit - ignore
    if (String(e?.message || "").toLowerCase().includes("duplicate")) return;
    throw e;
  }
}

/**
 * Claims and processes jobs.
 * - Uses a simple lock (lockedAt) to avoid concurrent workers sending duplicates.
 */
export async function processJobs(opts?: { limit?: number }) {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  const lockTtlMs = 5 * 60 * 1000; // 5 minutes

  let processed = 0;

  for (let i = 0; i < limit; i++) {
    const cutoff = new Date(Date.now() - lockTtlMs);

    // Find one available job
    const next = await db
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.status, "queued"),
          lte(jobQueue.runAt, now()),
          or(isNull(jobQueue.lockedAt), lte(jobQueue.lockedAt, cutoff))
        )
      )
      .orderBy(asc(jobQueue.runAt), asc(jobQueue.id))
      .limit(1);

    const job = next[0];
    if (!job) break;

    // Try to lock it
    const locked = await db
      .update(jobQueue)
      .set({
        status: "processing",
        lockedAt: now(),
        updatedAt: now(),
      })
      .where(and(eq(jobQueue.id, job.id), eq(jobQueue.status, "queued")))
      .returning({ id: jobQueue.id });

    if (!locked[0]) continue; // race

    try {
      await handleJob(job.type as JobType, job.payload);

      await db
        .update(jobQueue)
        .set({
          status: "done",
          lastError: null,
          lockedAt: null,
          updatedAt: now(),
        })
        .where(eq(jobQueue.id, job.id));

      processed++;
    } catch (err: any) {
      const msg = String(err?.stack || err?.message || err);
      const nextAttempts = Number(job.attempts ?? 0) + 1;
      const maxAttempts = 5;

      // Exponential backoff (30s, 60s, 120s, 240s, 480s)
      const backoffMs = Math.min(
        30_000 * Math.pow(2, nextAttempts - 1),
        10 * 60_000
      );
      const nextRunAt = new Date(Date.now() + backoffMs);

      if (nextAttempts < maxAttempts) {
        // ✅ retry: re-queue
        await db
          .update(jobQueue)
          .set({
            status: "queued",
            attempts: sql`${jobQueue.attempts} + 1`,
            lastError: msg.slice(0, 5000),
            lockedAt: null,
            runAt: nextRunAt,
            updatedAt: now(),
          })
          .where(eq(jobQueue.id, job.id));
      } else {
        // ❌ exhausted
        await db
          .update(jobQueue)
          .set({
            status: "failed",
            attempts: sql`${jobQueue.attempts} + 1`,
            lastError: msg.slice(0, 5000),
            lockedAt: null,
            updatedAt: now(),
          })
          .where(eq(jobQueue.id, job.id));
      }

      // keep going
    }
  }

  return { processed };
}

async function handleJob(type: JobType, payloadStr: string) {
  const db = await getDb();

  if (type === "dispatch_notification") {
    const payload = safeJsonParse<DispatchNotificationPayload>(payloadStr);

    const notif = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, payload.notificationId))
      .limit(1);

    const n = notif[0];
    if (!n) return;

    // Determine audience
    let userIds: number[] = (payload.userIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (!userIds.length) {
      const creatorRows = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, Number(n.createdBy)))
        .limit(1);

      const creatorRole = String(creatorRows[0]?.role || "admin");
      const isOwner = creatorRole === "owner";
      const actorId = Number(n.createdBy);

      if (n.targetType === "all") {
        const rows = await db
          .select({ id: users.id })
          .from(users)
          .where(
            isOwner
              ? and(eq(users.tenantId, n.tenantId), eq(users.role, "user"))
              : and(eq(users.tenantId, n.tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId))
          );
        userIds = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
      } else if (n.targetType === "users") {
        const ids = (n.targetIds || []) as unknown as number[];
        const rows = await db
          .select({ id: users.id })
          .from(users)
          .where(
            isOwner
              ? and(eq(users.tenantId, n.tenantId), eq(users.role, "user"), inArray(users.id, ids))
              : and(eq(users.tenantId, n.tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId), inArray(users.id, ids))
          );
        userIds = rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
      } else if (n.targetType === "groups") {
        const groupIds = ((n.targetIds || []) as unknown as number[]).map((id) => Number(id)).filter((id) => Number.isFinite(id));
        if (isOwner) {
          const members = await db
            .select({ userId: userGroups.userId })
            .from(userGroups)
            .innerJoin(users, eq(users.id, userGroups.userId))
            .where(
              and(
                inArray(userGroups.groupId, groupIds),
                eq(users.tenantId, n.tenantId),
                eq(users.role, "user")
              )
            );
          userIds = members.map((m) => Number(m.userId)).filter((id) => Number.isFinite(id));
        } else {
          const members = await db
            .select({ userId: userGroups.userId })
            .from(userGroups)
            .innerJoin(users, eq(users.id, userGroups.userId))
            .where(
              and(
                inArray(userGroups.groupId, groupIds),
                eq(users.tenantId, n.tenantId),
                eq(users.role, "user"),
                eq(users.createdByAdminId, actorId)
              )
            );
          userIds = members.map((m) => Number(m.userId)).filter((id) => Number.isFinite(id));
        }
      }

      userIds = [...new Set(userIds)];
    }

    // Create deliveries idempotently (unique constraint may not exist, so we best-effort)
    if (userIds.length) {
      await db.transaction(async (tx) => {
        for (const uid of userIds) {
          await tx
            .insert(deliveries)
            .values({
              tenantId: n.tenantId,
              notificationId: n.id,
              userId: uid,
              status: "delivered",
              deliveredAt: now(),
              isRead: false,
            })
            .onConflictDoNothing({
              target: [deliveries.tenantId, deliveries.notificationId, deliveries.userId],
            });
}
      });
    }

    const dispatchedAt = now();
    let pushResult;

    try {
      pushResult = await sendPushToUsers({
        tenantId: n.tenantId,
        userIds,
        title: n.title,
        content: n.content,
        notificationId: n.id,
      });
    } catch (err: any) {
      const msg = String(err?.stack || err?.message || err).slice(0, 5000);
      if (n.scheduleId) {
        await db
          .update(schedules)
          .set({
            lastRunAt: dispatchedAt,
            lastRunStatus: "failed",
            lastRunMessage: msg,
            lastNotificationId: n.id,
            lastTargetCount: userIds.length,
            lastSuccessCount: 0,
            lastFailureCount: userIds.length,
          })
          .where(eq(schedules.id, n.scheduleId));

        await syncScheduleAdminAlert({
          db,
          scheduleId: Number(n.scheduleId),
          creatorId: Number(n.createdBy),
          tenantId: Number(n.tenantId),
          scheduleTitle: String(n.title || `Agendamento #${n.scheduleId}`),
          status: "failed",
          message: msg,
          targetCount: userIds.length,
          successCount: 0,
          failureCount: userIds.length,
          notificationId: Number(n.id),
          executedAt: dispatchedAt,
        });
      }
      throw err;
    }

    const pushSentUserIds = [...new Set(pushResult?.sentUserIds ?? [])];
    const pushFailedUserIds = [...new Set(pushResult?.failedUserIds ?? [])];
    const pushSkippedUserIds = [...new Set(pushResult?.skippedUserIds ?? [])];

    if (userIds.length) {
      await db
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: dispatchedAt, errorMessage: null })
        .where(
          and(
            eq(deliveries.notificationId, n.id),
            inArray(deliveries.userId, userIds)
          )
        );
    }

    if (pushFailedUserIds.length) {
      for (const userId of pushFailedUserIds) {
        await db
          .update(deliveries)
          .set({
            status: "delivered",
            deliveredAt: dispatchedAt,
            errorMessage: String(pushResult?.errorsByUserId?.[userId] || "Falha ao enviar push; entregue na caixa de entrada").slice(0, 5000),
          })
          .where(and(eq(deliveries.notificationId, n.id), eq(deliveries.userId, userId)));
      }
    }

    if (pushSkippedUserIds.length) {
      for (const userId of pushSkippedUserIds) {
        await db
          .update(deliveries)
          .set({
            status: "delivered",
            deliveredAt: dispatchedAt,
            errorMessage: String(pushResult?.errorsByUserId?.[userId] || "Usuário sem push ativo; entregue na caixa de entrada").slice(0, 5000),
          })
          .where(and(eq(deliveries.notificationId, n.id), eq(deliveries.userId, userId)));
      }
    }

    if (n.scheduleId) {
      const successCount = userIds.length;
      const failureCount = 0;
      const skippedCount = pushSkippedUserIds.length;
      const pushFailedCount = pushFailedUserIds.length;
      const pushSentCount = pushSentUserIds.length;
      const messageParts: string[] = [];
      if (!pushResult?.pushConfigured) messageParts.push("Entrega garantida na caixa de entrada; push desativado porque o VAPID não está configurado");
      else {
        if (pushSentCount > 0) messageParts.push(`${pushSentCount} push enviado(s)`);
        if (skippedCount > 0) messageParts.push(`${skippedCount} usuário(s) sem push ativo; entregue(s) na caixa de entrada`);
        if (pushFailedCount > 0) messageParts.push(`${pushFailedCount} push com falha; mensagem preservada na caixa de entrada`);
      }

      const finalStatus = pushFailedCount > 0 ? "partial" : "sent";
      const finalMessage = messageParts.length ? messageParts.join(" • ") : "Entregue na caixa de entrada";

      await db
        .update(schedules)
        .set({
          lastRunAt: dispatchedAt,
          lastRunStatus: finalStatus,
          lastRunMessage: finalMessage,
          lastNotificationId: n.id,
          lastTargetCount: userIds.length,
          lastSuccessCount: successCount,
          lastFailureCount: failureCount,
        })
        .where(eq(schedules.id, n.scheduleId));

      await syncScheduleAdminAlert({
        db,
        scheduleId: Number(n.scheduleId),
        creatorId: Number(n.createdBy),
        tenantId: Number(n.tenantId),
        scheduleTitle: String(n.title || `Agendamento #${n.scheduleId}`),
        status: finalStatus,
        message: finalMessage,
        targetCount: userIds.length,
        successCount,
        failureCount,
        notificationId: Number(n.id),
        executedAt: dispatchedAt,
      });
    }

    return;
  }

  throw new Error(`Unknown job type: ${type}`);
}
