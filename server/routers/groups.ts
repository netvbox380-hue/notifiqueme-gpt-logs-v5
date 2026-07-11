import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { groups, userGroups, users, deliveries } from "../../drizzle/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function requireTenantAdmin(ctx: any): number {
  if (ctx.user?.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner usa superadmin",
    });
  }

  const t = ctx.user?.tenantId;
  if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });

  return t;
}

export const groupsRouter = router({
  list: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const data = await db
        .select({
          id: groups.id,
          tenantId: groups.tenantId,
          name: groups.name,
          description: groups.description,
          createdByAdminId: groups.createdByAdminId,
          createdAt: groups.createdAt,
          updatedAt: groups.updatedAt,
          memberCount: sql<number>`count(distinct ${userGroups.userId})::int`,
          deliveredCount: sql<number>`coalesce(count(distinct ${deliveries.id}), 0)::int`,
          readCount: sql<number>`coalesce(count(distinct case when ${deliveries.isRead} = true then ${deliveries.id} end), 0)::int`,
          failedCount: sql<number>`coalesce(count(distinct case when ${deliveries.status} = 'failed' then ${deliveries.id} end), 0)::int`,
        })
        .from(groups)
        .leftJoin(userGroups, eq(userGroups.groupId, groups.id))
        .leftJoin(
          users,
          and(eq(users.id, userGroups.userId), eq(users.tenantId, tenantId), eq(users.role, "user"))
        )
        .leftJoin(
          deliveries,
          and(eq(deliveries.userId, users.id), eq(deliveries.tenantId, tenantId))
        )
        .where(eq(groups.tenantId, tenantId))
        .groupBy(groups.id)
        .orderBy(sql`${groups.id} DESC`)
        .limit(input?.limit ?? 100);

      const totalRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(groups)
        .where(eq(groups.tenantId, tenantId));

      return {
        data: data.map((row: any) => {
          const deliveredCount = Number(row.deliveredCount ?? 0);
          const readCount = Number(row.readCount ?? 0);
          return {
            ...row,
            memberCount: Number(row.memberCount ?? 0),
            deliveredCount,
            readCount,
            failedCount: Number(row.failedCount ?? 0),
            readRate: deliveredCount > 0 ? Math.round((readCount / deliveredCount) * 100) : 0,
          };
        }),
        total: Number(totalRows?.[0]?.count ?? 0),
      };
    }),


  overview: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const tenantId = requireTenantAdmin(ctx);

    const [totals] = await db
      .select({
        totalGroups: sql<number>`count(distinct ${groups.id})::int`,
        totalParticipations: sql<number>`coalesce(count(distinct ${userGroups.id}), 0)::int`,
        groupedUsers: sql<number>`coalesce(count(distinct ${userGroups.userId}), 0)::int`,
      })
      .from(groups)
      .leftJoin(userGroups, eq(userGroups.groupId, groups.id))
      .leftJoin(users, and(eq(users.id, userGroups.userId), eq(users.tenantId, tenantId), eq(users.role, "user")))
      .where(eq(groups.tenantId, tenantId));

    return {
      totalGroups: Number(totals?.totalGroups ?? 0),
      totalParticipations: Number(totals?.totalParticipations ?? 0),
      groupedUsers: Number(totals?.groupedUsers ?? 0),
    };
  }),
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const inserted = await db
        .insert(groups)
        .values({
          tenantId,
          name: input.name,
          description: input.description ?? null,
          createdByAdminId: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .returning();

      return { success: true, group: inserted[0] };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const patch: any = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;

      const updated = await db
        .update(groups)
        .set(patch)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .returning();

      return { success: true, group: updated[0] };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      await db.transaction(async (tx) => {
        await tx.delete(userGroups).where(eq(userGroups.groupId, input.id));
        await tx.delete(groups).where(and(eq(groups.id, input.id), eq(groups.tenantId, tenantId)));
      });

      return { success: true };
    }),

  getMembers: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const rows = await db
        .select({ userId: userGroups.userId })
        .from(userGroups)
        .where(eq(userGroups.groupId, input.groupId));

      return { userIds: rows.map((r) => r.userId) };
    }),

  /**
   * 🔥 Atualização segura + sincronização futura
   */
  setMembers: adminProcedure
    .input(
      z.object({
        groupId: z.number(),
        memberUserIds: z.array(z.number()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const uniqueUserIds = Array.from(new Set(input.memberUserIds));

      if (uniqueUserIds.length) {
        const validUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.role, "user"), inArray(users.id, uniqueUserIds)));

        const validIds = new Set(validUsers.map((u) => u.id));
        const bad = uniqueUserIds.filter((id) => !validIds.has(id));

        if (bad.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Usuários inválidos",
          });
      }

      await db.transaction(async (tx) => {
        await tx.delete(userGroups).where(eq(userGroups.groupId, input.groupId));

        if (uniqueUserIds.length) {
          await tx.insert(userGroups).values(
            uniqueUserIds.map((userId) => ({
              groupId: input.groupId,
              userId,
              createdAt: new Date(),
            }))
          );
        }
      });

      return { success: true };
    }),

  /**
   * 🔥 Estatísticas do grupo (feedback e leitura)
   */
  stats: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(and(eq(groups.id, input.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);

      if (!found.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Grupo não encontrado" });

      const members = await db
        .select({
          userId: userGroups.userId,
          name: users.name,
          openId: users.openId,
          lastSignedIn: users.lastSignedIn,
        })
        .from(userGroups)
        .innerJoin(users, and(eq(users.id, userGroups.userId), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .where(eq(userGroups.groupId, input.groupId))
        .orderBy(desc(users.lastSignedIn));

      const userIds = members.map((m) => Number(m.userId));

      if (!userIds.length) {
        return {
          members: 0,
          reads: 0,
          delivered: 0,
          failed: 0,
          readRate: 0,
          feedback: {
            liked: 0,
            renew: 0,
            disliked: 0,
            no_renew: 0,
            problem: 0,
          },
          topMembers: [],
        };
      }

      const rows = await db
        .select({
          userId: deliveries.userId,
          isRead: deliveries.isRead,
          feedback: deliveries.feedback,
          status: deliveries.status,
        })
        .from(deliveries)
        .where(and(eq(deliveries.tenantId, tenantId), inArray(deliveries.userId, userIds)));

      let reads = 0;
      let delivered = 0;
      let failed = 0;
      const fb: any = { liked: 0, renew: 0, disliked: 0, no_renew: 0, problem: 0 };
      const perUser = new Map<number, { delivered: number; read: number; failed: number }>();

      for (const r of rows as any[]) {
        const uid = Number(r.userId);
        const bucket = perUser.get(uid) ?? { delivered: 0, read: 0, failed: 0 };
        bucket.delivered += 1;
        delivered += 1;
        if (r.isRead) {
          reads += 1;
          bucket.read += 1;
        }
        if (String(r.status) === "failed") {
          failed += 1;
          bucket.failed += 1;
        }
        if (r.feedback && fb[r.feedback] !== undefined) fb[r.feedback] += 1;
        perUser.set(uid, bucket);
      }

      return {
        members: userIds.length,
        reads,
        delivered,
        failed,
        readRate: delivered > 0 ? Math.round((reads / delivered) * 100) : 0,
        feedback: fb,
        topMembers: members.slice(0, 10).map((m: any) => {
          const stats = perUser.get(Number(m.userId)) ?? { delivered: 0, read: 0, failed: 0 };
          return {
            userId: Number(m.userId),
            name: m.name || m.openId || `Usuário #${m.userId}`,
            delivered: stats.delivered,
            read: stats.read,
            failed: stats.failed,
            lastSignedIn: m.lastSignedIn,
            readRate: stats.delivered > 0 ? Math.round((stats.read / stats.delivered) * 100) : 0,
          };
        }),
      };
    }),
});
