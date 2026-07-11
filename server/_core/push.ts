import webpush from "web-push";
import { and, eq, inArray, sql } from "drizzle-orm";

import { ENV } from "./env";
import { getDb } from "../db";
import { deliveries, pushSubscriptions } from "../../drizzle/schema";

type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

type SendPushParams = {
  tenantId: number;
  userIds: number[];
  title: string;
  content: string;
  notificationId: number;
};

export type PushDispatchResult = {
  sentUserIds: number[];
  failedUserIds: number[];
  skippedUserIds: number[];
  errorsByUserId: Record<number, string>;
  pushConfigured: boolean;
};

function configureVapid(): boolean {
  if (!ENV.vapidPublicKey || !ENV.vapidPrivateKey) return false;
  webpush.setVapidDetails(
    ENV.vapidSubject || "mailto:admin@localhost",
    ENV.vapidPublicKey,
    ENV.vapidPrivateKey,
  );
  return true;
}

function emptyResult(pushConfigured: boolean): PushDispatchResult {
  return {
    sentUserIds: [],
    failedUserIds: [],
    skippedUserIds: [],
    errorsByUserId: {},
    pushConfigured,
  };
}

function normalizeUserIds(userIds: number[]): number[] {
  return Array.from(
    new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  );
}

function getErrorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message.slice(0, 5000);
  return String(reason || "Falha ao enviar push").slice(0, 5000);
}

function shouldPruneSubscription(reason: unknown): boolean {
  const error = reason as {
    statusCode?: unknown;
    status?: unknown;
    body?: unknown;
    message?: unknown;
  };
  const statusCode = Number(error?.statusCode ?? error?.status ?? 0);
  if (statusCode === 404 || statusCode === 410) return true;

  const message = String(
    error?.body ?? error?.message ?? reason ?? "",
  ).toLowerCase();
  return ["expired", "not registered", "unsubscribe", "invalid token"].some(
    (value) => message.includes(value),
  );
}

function groupSubscriptionsByUser(
  subscriptions: PushSubscriptionRow[],
): Map<number, PushSubscriptionRow[]> {
  const grouped = new Map<number, PushSubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const list = grouped.get(subscription.userId) ?? [];
    list.push(subscription);
    grouped.set(subscription.userId, list);
  }
  return grouped;
}

export async function sendPushToUsers(
  params: SendPushParams,
): Promise<PushDispatchResult> {
  const userIds = normalizeUserIds(params.userIds);
  const pushConfigured = configureVapid();
  const result = emptyResult(pushConfigured);

  console.info("[PUSH DISPATCH] iniciado", {
    tenantId: params.tenantId,
    notificationId: params.notificationId,
    recipients: userIds.length,
    pushConfigured,
  });

  if (!userIds.length) return result;

  const db = await getDb();
  if (!db) {
    result.failedUserIds.push(...userIds);
    for (const userId of userIds)
      result.errorsByUserId[userId] = "Banco de dados indisponível";
    return result;
  }

  const [subscriptions, unreadRows, deliveryRows] = await Promise.all([
    db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds)),
    db
      .select({ userId: deliveries.userId, count: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.tenantId, params.tenantId),
          eq(deliveries.isRead, false),
          inArray(deliveries.userId, userIds),
        ),
      )
      .groupBy(deliveries.userId),
    db
      .select({ id: deliveries.id, userId: deliveries.userId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.tenantId, params.tenantId),
          eq(deliveries.notificationId, params.notificationId),
          inArray(deliveries.userId, userIds),
        ),
      ),
  ]);

  const unreadCountByUser = new Map(
    unreadRows.map((row) => [Number(row.userId), Number(row.count) || 0]),
  );
  const deliveryIdByUser = new Map(
    deliveryRows.map((row) => [Number(row.userId), Number(row.id)]),
  );
  const subscriptionsByUser = groupSubscriptionsByUser(subscriptions);

  console.info("[PUSH DISPATCH] subscriptions consultadas", {
    tenantId: params.tenantId,
    notificationId: params.notificationId,
    subscriptions: subscriptions.length,
    usersWithSubscription: subscriptionsByUser.size,
  });

  for (const userId of userIds) {
    const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
    if (!pushConfigured || !userSubscriptions.length) {
      result.skippedUserIds.push(userId);
      continue;
    }

    const payload = JSON.stringify({
      title: params.title,
      body: params.content,
      url: "/my-notifications",
      notificationId: params.notificationId,
      deliveryId: deliveryIdByUser.get(userId) ?? null,
      badgeCount: unreadCountByUser.get(userId) ?? 0,
    });

    const attempts = await Promise.allSettled(
      userSubscriptions.map(async (subscription) => {
        if (
          !subscription.endpoint ||
          !subscription.p256dh ||
          !subscription.auth
        ) {
          throw new Error(
            "Subscription push inválida: campos obrigatórios ausentes",
          );
        }

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { urgency: "high", TTL: 86400 },
          );
        } catch (error) {
          if (shouldPruneSubscription(error)) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, subscription.id))
              .catch(() => undefined);
          }
          throw error;
        }
      }),
    );

    if (attempts.some((attempt) => attempt.status === "fulfilled")) {
      result.sentUserIds.push(userId);
      continue;
    }

    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );
    if (
      rejected.length &&
      rejected.every((attempt) => shouldPruneSubscription(attempt.reason))
    ) {
      result.skippedUserIds.push(userId);
      result.errorsByUserId[userId] =
        "Assinatura push expirada ou inválida; entregue apenas na caixa de entrada";
      continue;
    }

    result.failedUserIds.push(userId);
    result.errorsByUserId[userId] = getErrorMessage(rejected[0]?.reason);
  }

  console.info("[PUSH DISPATCH] concluído", {
    tenantId: params.tenantId,
    notificationId: params.notificationId,
    sent: result.sentUserIds.length,
    failed: result.failedUserIds.length,
    skipped: result.skippedUserIds.length,
    errorsByUserId: result.errorsByUserId,
  });

  return result;
}
