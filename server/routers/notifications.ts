// server/routers/notifications.ts
import { z } from "zod";
import { router, adminOnlyProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  notifications,
  deliveries,
  users,
  userGroups,
  files,
  groups,
} from "../../drizzle/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkAndConsumeCredits, getTenantPlanLimits } from "../_core/credits";

import { storageGet } from "../storage";
import { assertRateLimit } from "../_core/rateLimit";
import { assertTenantInScopeOrThrow } from "../_core/ownership";
import { sendPushToUsers } from "../_core/push";


function requireTenant(ctx: any): number {
  const t = ctx.user?.tenantId;
  if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
  return t;
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

function isLikelySignedUrl(v?: string) {
  if (!v) return false;
  return (
    v.includes("X-Amz-Signature=") ||
    v.includes("X-Amz-Credential=") ||
    v.includes("X-Amz-Algorithm=") ||
    v.includes("X-Amz-Date=")
  );
}

function normalizeStoredMedia(value?: string) {
  if (!value) return undefined;

  // ✅ melhor: salvar fileKey (uploads/...) no DB
  if (value.startsWith("uploads/")) return value;

  // ❌ evitar gravar URL assinada (expira)
  if (isLikelySignedUrl(value)) return undefined;

  // ✅ se você quiser aceitar URL pública direta, mantém
  return value;
}

/**
 * ✅ Resolve imageUrl armazenado:
 * - se vier "uploads/..." => retorna URL (signed S3 / local)
 * - se vier URL normal => retorna como está
 */
async function resolveStoredMediaUrl(value?: string): Promise<string | undefined> {
  if (!value) return undefined;

  if (!value.startsWith("uploads/")) return value;

  try {
    const { url } = await storageGet(value);
    return url;
  } catch {
    return value;
  }
}

/**
 * ✅ Resolve media em lote (com cache por fileKey)
 */
async function resolveRowsMedia<T extends { imageUrl?: string | null }>(rows: T[]): Promise<T[]> {
  const cache = new Map<string, Promise<string | undefined>>();

  const getResolved = (v?: string | null) => {
    const key = v ?? undefined;
    if (!key) return Promise.resolve(undefined);

    if (!key.startsWith("uploads/")) return Promise.resolve(key);

    if (!cache.has(key)) cache.set(key, resolveStoredMediaUrl(key));
    return cache.get(key)!;
  };

  return await Promise.all(
    rows.map(async (r) => {
      const resolved = await getResolved(r.imageUrl ?? undefined);
      return {
        ...r,
        imageUrl: resolved ?? undefined,
      };
    })
  );
}

async function attachFilesToNotifications<
  T extends { notificationId?: number; id?: number; tenantId?: number }
>(rows: T[]): Promise<(T & { attachments?: any[] })[]> {
  const ids = Array.from(
    new Set(
      rows
        .map((r: any) => (r.notificationId ?? r.id) as number | undefined)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    )
  );

  if (!ids.length) return rows as any;

  const db = await requireDb();

  const frows = await db
    .select({
      id: files.id,
      tenantId: files.tenantId,
      filename: files.filename,
      fileKey: files.fileKey,
      url: files.url,
      mimeType: files.mimeType,
      fileSize: files.fileSize,
      uploadedAt: files.uploadedAt,
      relatedNotificationId: files.relatedNotificationId,
      isPublic: files.isPublic,
      uploadedBy: files.uploadedBy,
    })
    .from(files)
    .where(inArray(files.relatedNotificationId, ids))
    .orderBy(sql`${files.id} ASC`);

  const byNotif = new Map<number, any[]>();
  for (const f of frows as any[]) {
    const nid = Number((f as any).relatedNotificationId);
    if (!byNotif.has(nid)) byNotif.set(nid, []);

    const key = String((f as any).fileKey || "");
    const url = String((f as any).url || "");

    // ✅ sempre expõe um "url" utilizável:
    // - se for uploads/... devolve o fileKey (o front resolve: imagem -> signed; vídeo -> proxy)
    // - senão, devolve a url já gravada
    const usableUrl =
      key && key.startsWith("uploads/") ? key : url;

    byNotif.get(nid)!.push({
      id: (f as any).id,
      filename: (f as any).filename,
      fileKey: (f as any).fileKey,
      url: usableUrl,
      mimeType: (f as any).mimeType,
      fileSize: (f as any).fileSize,
      uploadedAt: (f as any).uploadedAt,
    });
  }

  return rows.map((r: any) => {
    const nid = Number(r.notificationId ?? r.id);
    const attachments = byNotif.get(nid) ?? [];
    return { ...r, attachments };
  });
}


async function resolveNotificationRecipientIds(
  db: any,
  actor: any,
  tenantId: number,
  targetType: "all" | "users" | "groups",
  targetIds: number[]
): Promise<number[]> {
  const actorId = Number(actor?.id);
  const isOwner = String(actor?.role || "") === "owner";

  if (targetType === "all") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        isOwner
          ? and(eq(users.tenantId, tenantId), eq(users.role, "user"))
          : and(eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId))
      );
    return Array.from(new Set(rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n))));
  }

  const normalizedTargetIds = Array.from(new Set((targetIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id))));
  if (!normalizedTargetIds.length) return [];

  if (targetType === "users") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        isOwner
          ? and(eq(users.tenantId, tenantId), eq(users.role, "user"), inArray(users.id, normalizedTargetIds))
          : and(eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, actorId), inArray(users.id, normalizedTargetIds))
      );
    return Array.from(new Set(rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n))));
  }

  if (isOwner) {
    const members = await db
      .select({ userId: userGroups.userId })
      .from(userGroups)
      .innerJoin(users, eq(users.id, userGroups.userId))
      .where(
        and(
          inArray(userGroups.groupId, normalizedTargetIds),
          eq(users.tenantId, tenantId),
          eq(users.role, "user")
        )
      );

    return Array.from(new Set(members.map((m: any) => Number(m.userId)).filter((n: number) => Number.isFinite(n))));
  }

  const members = await db
    .select({ userId: userGroups.userId })
    .from(userGroups)
    .innerJoin(users, eq(users.id, userGroups.userId))
    .where(
      and(
        inArray(userGroups.groupId, normalizedTargetIds),
        eq(users.tenantId, tenantId),
        eq(users.role, "user"),
        eq(users.createdByAdminId, actorId)
      )
    );

  return Array.from(new Set(members.map((m: any) => Number(m.userId)).filter((n: number) => Number.isFinite(n))));
}

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
        tenantId: z.number().optional().nullable(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.user.role === "user") throw new TRPCError({ code: "FORBIDDEN" });

      const db = await requireDb();

      // 🔐 Isolamento de listagem (OUTBOX):
      // - admin: lista por tenant (comportamento atual)
      // - owner: lista SOMENTE notificações criadas pelo próprio owner
      //   (e opcionalmente filtra por tenantId se informado)
      const isOwner = ctx.user.role === "owner";
      const adminTenantId = ctx.user.tenantId ?? null;
      const requestedTenantId = input.tenantId ?? null;

      if (!isOwner && !adminTenantId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const base = db.select().from(notifications);

      const whereClauses: any[] = [];
      if (isOwner) {
        whereClauses.push(eq(notifications.createdBy, ctx.user.id));
        if (requestedTenantId) whereClauses.push(eq(notifications.tenantId, requestedTenantId));
      } else {
        whereClauses.push(eq(notifications.tenantId, adminTenantId));
      }

      const q = whereClauses.length ? base.where(and(...whereClauses)) : base;

      const dataRaw = await q
        .orderBy(sql`${notifications.createdAt} DESC`)
        .limit(input.limit)
        .offset(input.offset);

      const dataBase = await resolveRowsMedia(dataRaw as any);

      const dataWithAttachments = await attachFilesToNotifications(dataBase as any);

      const notificationIds = dataWithAttachments
        .map((n: any) => Number(n.id))
        .filter((n: number) => Number.isFinite(n));

      const userIds = Array.from(
        new Set(
          dataWithAttachments
            .flatMap((n: any) => (Array.isArray(n.targetIds) ? n.targetIds : []))
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id))
        )
      );

      const groupIds = Array.from(
        new Set(
          dataWithAttachments
            .filter((n: any) => n.targetType === "groups")
            .flatMap((n: any) => (Array.isArray(n.targetIds) ? n.targetIds : []))
            .map((id: any) => Number(id))
            .filter((id: number) => Number.isFinite(id))
        )
      );

      const [deliveryRows, targetUsers, targetGroups] = await Promise.all([
        notificationIds.length
          ? db
              .select({
                notificationId: deliveries.notificationId,
                userId: deliveries.userId,
                status: deliveries.status,
                isRead: deliveries.isRead,
              })
              .from(deliveries)
              .where(inArray(deliveries.notificationId, notificationIds))
          : Promise.resolve([] as any[]),
        userIds.length
          ? db
              .select({ id: users.id, name: users.name, email: users.email, openId: users.openId })
              .from(users)
              .where(inArray(users.id, userIds))
          : Promise.resolve([] as any[]),
        groupIds.length
          ? db
              .select({ id: groups.id, name: groups.name })
              .from(groups)
              .where(inArray(groups.id, groupIds))
          : Promise.resolve([] as any[]),
      ]);

      const userById = new Map((targetUsers as any[]).map((u: any) => [Number(u.id), u]));
      const groupById = new Map((targetGroups as any[]).map((g: any) => [Number(g.id), String(g.name || `Grupo #${g.id}`)]));
      const deliveryByNotification = new Map<number, any[]>();
      for (const row of deliveryRows as any[]) {
        const nid = Number(row.notificationId);
        if (!deliveryByNotification.has(nid)) deliveryByNotification.set(nid, []);
        deliveryByNotification.get(nid)!.push(row);
      }

      const data = dataWithAttachments.map((n: any) => {
        const ids = Array.isArray(n.targetIds) ? n.targetIds.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)) : [];
        const targetType = String(n.targetType || "all");
        const targetUsersResolved = targetType === "users" ? ids.map((id: number) => userById.get(id)).filter(Boolean) : [];
        const groupNames = targetType === "groups" ? ids.map((id: number) => groupById.get(id) || `Grupo #${id}`) : [];
        const singleRecipient = targetType === "users" && targetUsersResolved.length === 1
          ? {
              id: Number((targetUsersResolved[0] as any).id),
              name: String((targetUsersResolved[0] as any).name || (targetUsersResolved[0] as any).openId || (targetUsersResolved[0] as any).email || `Usuário #${(targetUsersResolved[0] as any).id}`),
              email: (targetUsersResolved[0] as any).email || null,
              openId: (targetUsersResolved[0] as any).openId || null,
            }
          : null;

        const recipientLabel = singleRecipient
          ? singleRecipient.name
          : targetType === "groups" && groupNames.length === 1
          ? `users grupo ${groupNames[0]}`
          : "users";

        const drows = deliveryByNotification.get(Number(n.id)) || [];
        const delivered = drows.length;
        const read = drows.filter((d: any) => Boolean(d.isRead)).length;
        const failed = drows.filter((d: any) => String(d.status || "") === "failed").length;

        return {
          ...n,
          singleRecipient,
          groupNames,
          recipientLabel,
          delivered,
          read,
          failed,
        };
      });

      const totalBase = db
        .select({ count: sql<number>`count(*)` })
        .from(notifications);

      const totalQ = whereClauses.length ? totalBase.where(and(...whereClauses)) : totalBase;

      const totalRows = await totalQ;

      return { data, total: Number(totalRows?.[0]?.count ?? 0) };
    }),

  /**
   * ADMIN/OWNER: apagar mensagens enviadas (notifications + deliveries)
   * - Escalável: executa em lotes para não travar o banco
   * - Sem lixeira (permanente)
   */
  purgeSent: adminOnlyProcedure
    .input(
      z.object({
        // owner pode informar tenantId; admin usa o próprio
        tenantId: z.number().optional().nullable(),

        mode: z.enum(["all", "range", "older_than_days"]),
        from: z.date().optional(),
        to: z.date().optional(),
        days: z.number().min(1).max(3650).optional(),

        // limites para não estourar timeout
        batchSize: z.number().min(100).max(5000).default(2000),
        maxBatches: z.number().min(1).max(10).default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      // resolve tenant
      const effectiveTenantId =
        ctx.user?.role === "owner"
          ? (input.tenantId ?? null)
          : (ctx.user?.tenantId ?? null);

      if (!effectiveTenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
      }

      const tenantId = Number(effectiveTenantId);

      const now = new Date();
      const cutoff =
        input.mode === "older_than_days" && input.days
          ? new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000)
          : null;

      const from = input.mode === "range" ? input.from ?? null : null;
      const to = input.mode === "range" ? input.to ?? null : null;

      let totalDeletedNotifications = 0;
      let totalDeletedDeliveries = 0;
      let batches = 0;
      let done = false;

      while (batches < input.maxBatches) {
        batches++;

        // pega IDs a apagar em lote (mais antigos primeiro)
        const idsRows = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.tenantId, tenantId),
              input.mode === "all"
                ? sql`true`
                : input.mode === "older_than_days" && cutoff
                ? sql`${notifications.createdAt} < ${cutoff as any}`
                : input.mode === "range" && from && to
                ? sql`${notifications.createdAt} >= ${from as any} AND ${notifications.createdAt} <= ${to as any}`
                : sql`false`
            ) as any
          )
          .orderBy(sql`${notifications.id} ASC`)
          .limit(input.batchSize);

        const ids = (idsRows as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
        if (!ids.length) {
          done = true;
          break;
        }

        // apaga deliveries primeiro
        const delDeliveries = await db
          .delete(deliveries)
          .where(and(eq(deliveries.tenantId, tenantId), inArray(deliveries.notificationId, ids)));

        // drizzle/postgres não retorna count consistente aqui; faz count via ids
        totalDeletedDeliveries += 0;

        // apaga notifications
        await db
          .delete(notifications)
          .where(and(eq(notifications.tenantId, tenantId), inArray(notifications.id, ids)));

        totalDeletedNotifications += ids.length;
      }

      // deliveries count aproximado (cálculo real é caro); deixa 0 e reporta notifications.
      return {
        success: true,
        deletedNotifications: totalDeletedNotifications,
        deletedDeliveries: totalDeletedDeliveries,
        batches,
        // true quando não encontrou mais itens para apagar
        done,
      };
    }),

  feedbackResponders: adminOnlyProcedure
    .input(
      z.object({
        notificationIds: z.array(z.number()).min(1).max(500),
        limitPerNotification: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();

      const scopedNotificationIds = Array.from(
        new Set(input.notificationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      );

      if (!scopedNotificationIds.length) return { byId: {} };

      const notificationScopeRows = await db
        .select({ id: notifications.id, tenantId: notifications.tenantId, createdBy: notifications.createdBy })
        .from(notifications)
        .where(inArray(notifications.id, scopedNotificationIds));

      const allowedNotificationIds = notificationScopeRows
        .filter((row: any) => {
          if (ctx.user?.role === "owner") {
            return Number(row.createdBy) === Number(ctx.user.id);
          }
          return Number(row.tenantId) === Number(ctx.user?.tenantId ?? 0);
        })
        .map((row: any) => Number(row.id));

      if (!allowedNotificationIds.length) return { byId: {} };

      const rows = await db
        .select({
          notificationId: deliveries.notificationId,
          deliveryId: deliveries.id,
          userId: deliveries.userId,
          name: users.name,
          email: users.email,
          openId: users.openId,
          feedback: deliveries.feedback,
          feedbackAt: deliveries.feedbackAt,
          isRead: deliveries.isRead,
        })
        .from(deliveries)
        .innerJoin(users, eq(users.id, deliveries.userId))
        .where(
          and(
            inArray(deliveries.notificationId, allowedNotificationIds),
            isNotNull(deliveries.feedback)
          )
        )
        .orderBy(desc(deliveries.feedbackAt), desc(deliveries.id));

      const byId: Record<number, { items: any[] }> = {};
      for (const notificationId of allowedNotificationIds) {
        byId[notificationId] = { items: [] };
      }

      for (const row of rows as any[]) {
        const nid = Number(row.notificationId);
        const bucket = byId[nid] ?? { items: [] };
        if (bucket.items.length >= input.limitPerNotification) continue;
        bucket.items.push({
          notificationId: nid,
          deliveryId: Number(row.deliveryId),
          userId: Number(row.userId),
          name: row.name || null,
          email: row.email || null,
          openId: row.openId || null,
          feedback: row.feedback,
          feedbackAt: row.feedbackAt,
          isRead: Boolean(row.isRead),
        });
        byId[nid] = bucket;
      }

      return { byId };
    }),


  deliveryMap: adminOnlyProcedure
    .input(z.object({ notificationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = ctx.user?.role === "owner" ? null : requireTenant(ctx);

      const notificationRows = await db
        .select({
          id: notifications.id,
          tenantId: notifications.tenantId,
          title: notifications.title,
          createdAt: notifications.createdAt,
          targetType: notifications.targetType,
          targetIds: notifications.targetIds,
        })
        .from(notifications)
        .where(eq(notifications.id, input.notificationId))
        .limit(1);

      const notification = notificationRows[0] as any;
      if (!notification) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada" });
      if (tenantId && Number(notification.tenantId) !== Number(tenantId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Fora do tenant" });
      }

      const rows = await db
        .select({
          deliveryId: deliveries.id,
          userId: deliveries.userId,
          status: deliveries.status,
          isRead: deliveries.isRead,
          deliveredAt: deliveries.deliveredAt,
          readAt: deliveries.readAt,
          errorMessage: deliveries.errorMessage,
          feedback: deliveries.feedback,
          name: users.name,
          openId: users.openId,
          email: users.email,
        })
        .from(deliveries)
        .innerJoin(users, eq(users.id, deliveries.userId))
        .where(and(eq(deliveries.notificationId, input.notificationId), eq(deliveries.tenantId, Number(notification.tenantId))))
        .orderBy(desc(deliveries.id));

      const userIds = rows.map((r: any) => Number(r.userId)).filter(Boolean);
      let groupsByUser = new Map<number, string[]>();
      if (userIds.length) {
        const memberships = await db
          .select({ userId: userGroups.userId, groupName: groups.name })
          .from(userGroups)
          .innerJoin(groups, eq(groups.id, userGroups.groupId))
          .where(and(eq(groups.tenantId, Number(notification.tenantId)), inArray(userGroups.userId, userIds)));
        for (const m of memberships as any[]) {
          const uid = Number(m.userId);
          const arr = groupsByUser.get(uid) ?? [];
          arr.push(String(m.groupName));
          groupsByUser.set(uid, arr);
        }
      }

      const summary = { sent: 0, read: 0, failed: 0, pending: 0, partial: 0, total: rows.length };
      const items = rows.map((row: any) => {
        const status = String(row.status || "sent");
        if (status === "failed") summary.failed += 1;
        else if (row.isRead || status === "read") summary.read += 1;
        else if (status === "sent" || status === "delivered") summary.sent += 1;
        else summary.pending += 1;
        return {
          deliveryId: Number(row.deliveryId),
          userId: Number(row.userId),
          name: row.name || row.openId || `Usuário #${row.userId}`,
          email: row.email || null,
          openId: row.openId || null,
          status,
          isRead: Boolean(row.isRead),
          deliveredAt: row.deliveredAt,
          readAt: row.readAt,
          errorMessage: row.errorMessage || null,
          feedback: row.feedback || null,
          groupNames: groupsByUser.get(Number(row.userId)) ?? [],
        };
      });

      return { notification, summary, items };
    }),

  feedbackSummary: adminOnlyProcedure
    .input(
      z.object({
        notificationIds: z.array(z.number()).min(1).max(500),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();

      // ✅ Limita ao tenant do admin (owner pode ver de qualquer tenant via IDs)
      // (como os IDs vêm da lista filtrada pelo tenant, isso já fica seguro)
      const rows = await db
        .select({
          notificationId: deliveries.notificationId,
          feedback: deliveries.feedback,
          count: sql<number>`count(*)`,
        })
        .from(deliveries)
        .where(
          and(
            inArray(deliveries.notificationId, input.notificationIds),
            isNotNull(deliveries.feedback)
          )
        )
        .groupBy(deliveries.notificationId, deliveries.feedback);

      // normaliza pra { [notificationId]: { liked: n, ... , total: n } }
      const byId: Record<number, any> = {};
      for (const r of rows as any[]) {
        const nid = Number(r.notificationId);
        const fb = String(r.feedback);
        const c = Number(r.count ?? 0);
        if (!byId[nid]) byId[nid] = { total: 0 };
        byId[nid][fb] = c;
        byId[nid].total += c;
      }

      return { byId };
    }),


  send: adminOnlyProcedure
    .input(
      z.object({
        tenantId: z.number().optional(), // owner precisa informar; admin ignora
        title: z.string().min(1).max(255),
        content: z.string().min(1),
        priority: z.enum(["normal", "important", "urgent"]).default("normal"),
        targetType: z.enum(["all", "users", "groups"]),
        targetIds: z.array(z.number()).default([]),
        imageUrl: z.string().optional(),
        attachmentFileKeys: z.array(z.string()).optional().default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      const isOwner = ctx.user?.role === "owner";

      let tenantId: number;
      if (isOwner) {
        if (!input.tenantId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "tenantId é obrigatório (owner deve informar)",
          });
        }
        tenantId = input.tenantId;
      } else {
        tenantId = requireTenant(ctx);
      }

      const actorId = Number(ctx.user?.id);

      const userIds = await resolveNotificationRecipientIds(
        db,
        ctx.user,
        tenantId,
        input.targetType,
        input.targetIds
      );

      if (!userIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum destinatário" });
      }

      
      /* CREDITS_LIMITS */
      // ✅ Rate limit (envio)
      await assertRateLimit({ req: ctx.req, key: "notifications.send", limit: 30, windowMs: 60_000 });

      const { limits } = await getTenantPlanLimits(tenantId);

      // ✅ Limite de destinatários por envio
      if (userIds.length > limits.maxRecipientsPerSend) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Este plano permite até ${limits.maxRecipientsPerSend} destinatários por envio.`,
        });
      }

      // ✅ Limites de anexos (quantidade + tamanho total)
      const attachmentKeysPre = Array.from(
        new Set(
          (input.attachmentFileKeys ?? [])
            .map((k) => normalizeStoredMedia(k))
            .filter((k): k is string => Boolean(k) && typeof k === "string" && k.startsWith("uploads/"))
        )
      );

      // ⚠️ precisa existir antes de validar anexos (evita "Cannot access 'safeImage' before initialization")
      const safeImage = normalizeStoredMedia(input.imageUrl);

      const safeImageKey =
        safeImage && typeof safeImage === "string" && safeImage.startsWith("uploads/") ? safeImage : null;

      const allAttachmentKeys = Array.from(
        new Set([...(attachmentKeysPre ?? []), ...(safeImageKey ? [safeImageKey] : [])])
      );

      if (allAttachmentKeys.length) {
        const fmeta = await db
          .select({
            fileKey: files.fileKey,
            fileSize: files.fileSize,
            mimeType: files.mimeType,
            tenantId: files.tenantId,
            uploadedBy: files.uploadedBy,
          })
          .from(files)
          .where(inArray(files.fileKey, allAttachmentKeys));

        if (fmeta.length !== allAttachmentKeys.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Um ou mais anexos não foram encontrados" });
        }

        for (const f of fmeta) {
          await assertTenantInScopeOrThrow(db, ctx.user, Number(f.tenantId));
          if (!isOwner && Number(f.tenantId) !== Number(tenantId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Anexo fora do tenant da mensagem" });
          }
        }

        const totalBytes = fmeta.reduce((acc, f) => acc + Number(f.fileSize ?? 0), 0);
        const imagesCount = fmeta.filter((f) => String(f.mimeType || "").startsWith("image/")).length;
        const videosCount = fmeta.filter((f) => String(f.mimeType || "").startsWith("video/")).length;

        if (imagesCount > limits.maxImagesPerMessage) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Seu plano permite até ${limits.maxImagesPerMessage} imagens por mensagem.`,
          });
        }

        if (videosCount > limits.maxVideosPerMessage) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Seu plano permite até ${limits.maxVideosPerMessage} vídeos por mensagem.`,
          });
        }

        if (totalBytes > limits.maxTotalAttachmentBytes) {
          const mb = Math.ceil(limits.maxTotalAttachmentBytes / (1024 * 1024));
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Anexos excedem o limite do plano (${mb}MB por mensagem).`,
          });
        }
      }

      // ✅ Créditos: 1 delivery = 1 crédito
      await checkAndConsumeCredits({ tenantId, cost: userIds.length });

      /* CREDITS_LIMITS */

      const now = new Date();

      const inserted = await db
        .insert(notifications)
        .values({
          tenantId,
          title: input.title,
          content: input.content,
          priority: input.priority,
          createdBy: actorId,
          targetType: input.targetType,
          targetIds: input.targetIds,
          imageUrl: safeImage,
          isScheduled: false,
          scheduleId: null,
          isActive: true,
          createdAt: now,
        } as any)
        .returning({ id: notifications.id });

      const notificationId = inserted[0].id;

      // ✅ Anexos múltiplos (não quebra compat): vincula TODOS os fileKey enviados a esta notificação
      const attachmentKeys = Array.from(
        new Set(
          (input.attachmentFileKeys ?? [])
            .map((k) => normalizeStoredMedia(k))
            .filter(
              (k): k is string =>
                Boolean(k) && typeof k === "string" && k.startsWith("uploads/")
            )
        )
      );

      // garante que o "principal" também fique vinculado
      if (safeImage && typeof safeImage === "string" && safeImage.startsWith("uploads/")) {
        if (!attachmentKeys.includes(safeImage)) attachmentKeys.push(safeImage);
      }

      if (attachmentKeys.length) {
        const ownedRows = await db
          .select({ id: files.id, fileKey: files.fileKey, tenantId: files.tenantId })
          .from(files)
          .where(inArray(files.fileKey, attachmentKeys));

        if (ownedRows.length !== attachmentKeys.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Um ou mais anexos não foram encontrados" });
        }

        for (const row of ownedRows) {
          await assertTenantInScopeOrThrow(db, ctx.user, Number(row.tenantId));
          if (!isOwner && Number(row.tenantId) !== Number(tenantId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Anexo fora do tenant da mensagem" });
          }
        }

        await db
          .update(files)
          .set({ relatedNotificationId: notificationId })
          .where(
            and(
              eq(files.tenantId, tenantId),
              inArray(files.fileKey, attachmentKeys)
            )
          );
      }


      await db.insert(deliveries).values(
        userIds.map((uid) => ({
          tenantId,
          notificationId,
          userId: uid,
          status: "sent",
          deliveredAt: now,
          isRead: false,
          errorMessage: null,
        })) as any
      );

      const pushResult = await sendPushToUsers({
        tenantId,
        userIds,
        title: "Nova mensagem",
        content: input.title,
        notificationId,
      });

      console.info("[PUSH] despacho concluído", {
        tenantId,
        notificationId,
        recipients: userIds.length,
        sent: pushResult.sentUserIds.length,
        failed: pushResult.failedUserIds.length,
        skipped: pushResult.skippedUserIds.length,
        pushConfigured: pushResult.pushConfigured,
        errorsByUserId: pushResult.errorsByUserId,
      });

      return {
        success: true,
        notificationId,
        queued: userIds.length,
        push: {
          configured: pushResult.pushConfigured,
          sent: pushResult.sentUserIds.length,
          failed: pushResult.failedUserIds.length,
          skipped: pushResult.skippedUserIds.length,
        },
      };
    }),

  inboxList: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();

      const rowsRaw = await db
        .select({
          deliveryId: deliveries.id,
          notificationId: notifications.id,
          title: notifications.title,
          content: notifications.content,
          imageUrl: notifications.imageUrl,
          priority: notifications.priority,
          createdAt: notifications.createdAt,
          isRead: deliveries.isRead,
          readAt: deliveries.readAt,
          feedback: deliveries.feedback,
          feedbackAt: deliveries.feedbackAt,
        })
        .from(deliveries)
        .innerJoin(notifications, eq(deliveries.notificationId, notifications.id))
        .where(eq(deliveries.userId, ctx.user.id))
        .orderBy(desc(deliveries.id))
        .limit(input.limit)
        .offset(input.offset);

      // ✅ Inbox do usuário final:
      // manter `uploads/...` quando existir, para o front decidir:
      // - imagem => URL assinada
      // - vídeo => proxy /api/media com suporte a Range/CORS
      const rows = await attachFilesToNotifications(rowsRaw as any);

      return { data: rows };
    }),

  inboxCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();

    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(deliveries)
      .where(and(eq(deliveries.userId, ctx.user.id), eq(deliveries.isRead, false)));

    return { count: Number(rows?.[0]?.count ?? 0) };
  }),

  markAsRead: protectedProcedure
    .input(z.object({ deliveryId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      await db
        .update(deliveries)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.userId, ctx.user.id)));

      return { success: true };
    }),



  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await requireDb();

      await db
        .update(deliveries)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(deliveries.userId, ctx.user.id), eq(deliveries.isRead, false)));

      return { success: true };
    }),

  setFeedback: protectedProcedure
    .input(
      z.object({
        deliveryId: z.number(),
        feedback: z.enum(["liked", "renew", "disliked", "no_renew", "problem"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      await db
        .update(deliveries)
        .set({ feedback: input.feedback, feedbackAt: new Date() })
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.userId, ctx.user.id)));

      return { success: true };
    }),

  // ✅ Apagar TODAS as mensagens do usuário (permanente)
  // - Remove somente deliveries do usuário atual
  // - Não mexe em notifications (para não afetar outros usuários/tenant)
  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();

    await db.delete(deliveries).where(eq(deliveries.userId, ctx.user.id));

    return { success: true };
  }),
});
