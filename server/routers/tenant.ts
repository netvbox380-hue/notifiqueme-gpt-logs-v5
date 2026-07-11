import { z } from "zod";
import { router, protectedProcedure, ownerProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  tenants,
  users,
  deliveries,
  userGroups,
  groups,
  notifications,
  schedules,
  logs,
} from "../../drizzle/schema";
import { eq, sql, count, and, inArray, gte, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sanitizeBrandingInput } from "../_core/branding";
import { isValidLoginIdOrEmail, isValidPassword, hashPassword } from "../_core/password";
import { getCreditsUsageToday, getTenantPlanLimits } from "../_core/credits";
import { EXTRA_CREDIT_PACKS, PLANS } from "../_core/plans";
import { getTenantStatusInfo } from "../_core/tenantAccess";


function normalizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/**
 * Regra do painel Admin (decisão A):
 * - Admin gerencia TODOS os usuários do seu tenant (não depende de createdByAdminId)
 * - Owner não gerencia users por aqui (usa superadmin)
 */
function requireTenantAdmin(ctx: any) {
  if (ctx.user?.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner não usa tenantRouter para users (use superadmin)",
    });
  }
  const tenantId = ctx.user?.tenantId;
  if (!tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
  }
  return tenantId as number;
}

export const tenantRouter = router({

/**
 * Catálogo comercial dos planos e extras
 */
getPlanCatalog: protectedProcedure.query(async () => {
  return {
    plans: Object.values(PLANS),
    extraCredits: EXTRA_CREDIT_PACKS,
    paymentMethods: ["mercado_pago", "pix"],
  };
}),

/**
 * Créditos do dia (1 delivery = 1 crédito)
 * - Admin: usa o próprio tenant
 * - Owner: deve informar tenantId
 */
getUsageToday: protectedProcedure
  .input(z.object({ tenantId: z.number().optional() }).optional())
  .query(async ({ ctx, input }) => {
    if (ctx.user?.role === "owner") {
      const tid = input?.tenantId;
      if (!tid) throw new TRPCError({ code: "BAD_REQUEST", message: "tenantId é obrigatório para owner" });
      const { limits, plan } = await getTenantPlanLimits(tid);
      const usage = await getCreditsUsageToday(tid);
      return { ...usage, plan, limit: limits.dailyCredits, remaining: Math.max(0, limits.dailyCredits - usage.creditsUsed) };
    }

    const tenantId = requireTenantAdmin(ctx);
    const { limits, plan } = await getTenantPlanLimits(tenantId);
    const usage = await getCreditsUsageToday(tenantId);
    return { ...usage, plan, limit: limits.dailyCredits, remaining: Math.max(0, limits.dailyCredits - usage.creditsUsed) };
  }),

/**
 * Limites do plano atual do tenant
 */
getPlanLimits: protectedProcedure
  .input(z.object({ tenantId: z.number().optional() }).optional())
  .query(async ({ ctx, input }) => {
    if (ctx.user?.role === "owner") {
      const tid = input?.tenantId;
      if (!tid) throw new TRPCError({ code: "BAD_REQUEST", message: "tenantId é obrigatório para owner" });
      const { limits, plan } = await getTenantPlanLimits(tid);
      return { plan, limits };
    }
    const tenantId = requireTenantAdmin(ctx);
    const { limits, plan } = await getTenantPlanLimits(tenantId);
    return { plan, limits };
  }),

  /**
   * ✅ Usuário comum: lê o próprio card informativo persistente (se ativo).
   * Personalizado por usuário — editado pelo admin em tenant.updateUser.
   */
  myAnnouncement: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

    if (!ctx.user?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

    const rows = await db
      .select({
        announcementEnabled: users.announcementEnabled,
        announcementBody: users.announcementBody,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    const row = rows[0];

    return {
      enabled: Boolean(row?.announcementEnabled),
      body: row?.announcementBody || null,
    };
  }),

  /**
   * Obter informações de assinatura do usuário atual
   */
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

    if (ctx.user?.role === "owner") {
      return {
        id: 0,
        name: "Administrador do Sistema (Owner)",
        slug: "owner",
        status: "active" as const,
        plan: "enterprise" as const,
        planDisplayName: PLANS.enterprise.displayName,
        monthlyPrice: PLANS.enterprise.monthlyPrice,
        limits: PLANS.enterprise,
        branding: null,
        subscriptionExpiresAt: null,
        isExpired: false,
        daysRemaining: 9999,
        isSuperAdmin: true,
        isOwner: true,
      };
    }

    if (!ctx.user?.tenantId) {
      return {
        id: 0,
        name: "Sem Tenant",
        slug: "",
        status: "active" as const,
        plan: "basic" as const,
        planDisplayName: PLANS.basic.displayName,
        monthlyPrice: PLANS.basic.monthlyPrice,
        limits: PLANS.basic,
        branding: null,
        subscriptionExpiresAt: null,
        isExpired: false,
        daysRemaining: 0,
        isSuperAdmin: false,
        isOwner: false,
      };
    }

    const result = await db.select().from(tenants).where(eq(tenants.id, ctx.user.tenantId)).limit(1);
    if (result.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });

    const tenant = result[0];
    const statusInfo = await getTenantStatusInfo(tenant.id);
    const expiresAt = tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt) : null;
    const now = new Date();
    const daysRemaining = expiresAt
      ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const limits = PLANS[(tenant.plan as keyof typeof PLANS) || "basic"] || PLANS.basic;

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: statusInfo.effectiveStatus,
      plan: tenant.plan,
      planDisplayName: limits.displayName,
      monthlyPrice: limits.monthlyPrice,
      limits,
      branding: {
        brandName: (tenant as any).brandName || null,
        brandLogoUrl: (tenant as any).brandLogoUrl || null,
        brandPrimaryColor: (tenant as any).brandPrimaryColor || null,
        supportPhone: (tenant as any).supportPhone || null,
        pixKey: (tenant as any).pixKey || null,
        mercadoPagoLink: (tenant as any).mercadoPagoLink || null,
      },
      subscriptionExpiresAt: ctx.user?.role === "admin" ? tenant.subscriptionExpiresAt : null,
      isExpired: statusInfo.isExpired,
      daysRemaining: Math.max(0, daysRemaining),
      isSuperAdmin: false,
      isOwner: false,
    };
  }),

  updateBranding: adminProcedure
    .input(z.object({
      brandName: z.string().min(1).max(255).optional().nullable(),
      brandLogoUrl: z.string().max(500).optional().nullable(),
      brandPrimaryColor: z.string().max(32).optional().nullable(),
      supportPhone: z.string().max(64).optional().nullable(),
      pixKey: z.string().max(255).optional().nullable(),
      mercadoPagoLink: z.string().max(500).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Use a gestão de tenants do owner para alterar branding." });
      }
      const tenantId = requireTenantAdmin(ctx);
      const { limits } = await getTenantPlanLimits(tenantId);
      if (!limits.whiteLabel) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "White-label disponível apenas nos planos Pro e Business." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });
      const branding = sanitizeBrandingInput(input);
      await db.update(tenants).set({
        brandName: branding.brandName ?? null,
        brandLogoUrl: branding.brandLogoUrl ?? null,
        brandPrimaryColor: branding.brandPrimaryColor ?? null,
        supportPhone: branding.supportPhone ?? null,
        pixKey: branding.pixKey ?? null,
        mercadoPagoLink: branding.mercadoPagoLink ?? null,
        updatedAt: new Date(),
      } as any).where(eq(tenants.id, tenantId));
      return { success: true };
    }),

  /**
   * Listar todos os tenants (apenas Owner)
   */
  listTenants: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return await db.select().from(tenants).orderBy(sql`${tenants.createdAt} DESC`);
  }),

  /**
   * Criar novo tenant (apenas Owner)
   */
  createTenant: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1, "Nome é obrigatório"),
        slug: z.string().min(1, "Slug é obrigatório"),
        plan: z.enum(["basic", "pro", "enterprise"]),
        months: z.number().min(1).default(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const slug = normalizeSlug(input.slug);
      if (!slug) throw new TRPCError({ code: "BAD_REQUEST", message: "Slug inválido" });

      const existing = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Slug já existe" });

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + input.months);

      const result = await db
        .insert(tenants)
        .values({
          name: input.name,
          slug,
          plan: input.plan,
          subscriptionExpiresAt: expiresAt,
          status: "active",
        })
        .returning({ id: tenants.id });

      return { success: true, tenantId: result[0]?.id || 0 };
    }),

  /**
   * Renovar assinatura (Owner)
   */
  renewSubscription: ownerProcedure
    .input(
      z.object({
        tenantId: z.number().positive("ID do tenant deve ser positivo"),
        months: z.number().positive("Número de meses deve ser positivo"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const result = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });

      const tenant = result[0];
      const currentExpiry = tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      const newExpiry = new Date(baseDate);
      newExpiry.setMonth(newExpiry.getMonth() + input.months);

      await db
        .update(tenants)
        .set({ subscriptionExpiresAt: newExpiry, status: "active", updatedAt: new Date() })
        .where(eq(tenants.id, input.tenantId));

      return { success: true, newExpiry };
    }),

  /**
   * Atualizar tenant (Owner)
   */
  updateTenant: ownerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        status: z.enum(["active", "suspended", "expired"]).optional(),
        plan: z.enum(["basic", "pro", "enterprise"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateData.name = input.name;
      if (input.status) updateData.status = input.status;
      if (input.plan) updateData.plan = input.plan;

      await db.update(tenants).set(updateData).where(eq(tenants.id, input.id));
      return { success: true };
    }),

  /**
   * Deletar tenant (Owner)
   */
  deleteTenant: ownerProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      await db.update(users).set({ tenantId: null, updatedAt: new Date() }).where(eq(users.tenantId, input));
      await db.delete(tenants).where(eq(tenants.id, input));

      return { success: true };
    }),

  /**
   * Admin pode ver seu próprio tenant
   */
  getMyTenant: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

    // Owner não tem tenant específico (adminProcedure aceita owner também)
    if (ctx.user?.role === "owner") {
      return {
        id: 0,
        name: "Sistema (Owner)",
        slug: "system",
        status: "active" as const,
        plan: "enterprise" as const,
        subscriptionExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: null,
      };
    }

    if (!ctx.user?.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Admin sem tenant" });

    const result = await db.select().from(tenants).where(eq(tenants.id, ctx.user.tenantId)).limit(1);
    if (result.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });

    return result[0];
  }),

  /**
   * Admin pode ver usuários do seu tenant (DECISÃO A)
   * - Owner não lista por aqui
   */
  listMyUsers: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const tenantId = requireTenantAdmin(ctx);

    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "user")))
      .orderBy(sql`${users.createdAt} DESC`);

    const ids = rows.map((u) => Number(u.id)).filter(Boolean);
    if (!ids.length) return rows;

    const memberships = await db
      .select({
        userId: userGroups.userId,
        groupId: groups.id,
        groupName: groups.name,
      })
      .from(userGroups)
      .innerJoin(groups, eq(groups.id, userGroups.groupId))
      .where(and(eq(groups.tenantId, tenantId), inArray(userGroups.userId, ids)));

    const deliveryStats = await db
      .select({
        userId: deliveries.userId,
        deliveredCount: sql<number>`count(*)::int`,
        readCount: sql<number>`count(case when ${deliveries.isRead} = true then 1 end)::int`,
        failedCount: sql<number>`count(case when ${deliveries.status} = 'failed' then 1 end)::int`,
        lastReadAt: sql<Date | null>`max(${deliveries.readAt})`,
      })
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, tenantId), inArray(deliveries.userId, ids)))
      .groupBy(deliveries.userId);

    const byUser = new Map<number, { groupIds: number[]; groupNames: string[] }>();
    const statsByUser = new Map<number, any>();

    for (const row of memberships) {
      const key = Number(row.userId);
      const current = byUser.get(key) ?? { groupIds: [], groupNames: [] };
      current.groupIds.push(Number(row.groupId));
      current.groupNames.push(String(row.groupName));
      byUser.set(key, current);
    }

    for (const stat of deliveryStats as any[]) {
      statsByUser.set(Number(stat.userId), {
        deliveredCount: Number(stat.deliveredCount ?? 0),
        readCount: Number(stat.readCount ?? 0),
        failedCount: Number(stat.failedCount ?? 0),
        lastReadAt: stat.lastReadAt ?? null,
      });
    }

    const now = Date.now();

    return rows.map((user) => {
      const membership = byUser.get(Number(user.id));
      const stats = statsByUser.get(Number(user.id)) ?? {
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        lastReadAt: null,
      };
      const lastSignedInAt = user.lastSignedIn ? new Date(user.lastSignedIn) : null;
      const daysSinceLastSignIn = lastSignedInAt ? Math.max(0, Math.floor((now - lastSignedInAt.getTime()) / 86400000)) : null;
      return {
        ...user,
        groupIds: membership?.groupIds ?? [],
        groupNames: membership?.groupNames ?? [],
        groupCount: membership?.groupIds?.length ?? 0,
        deliveredCount: stats.deliveredCount,
        readCount: stats.readCount,
        failedCount: stats.failedCount,
        readRate: stats.deliveredCount > 0 ? Math.round((stats.readCount / stats.deliveredCount) * 100) : 0,
        neverRead: stats.readCount === 0,
        neverOpenedMessage: stats.readCount === 0,
        lastReadAt: stats.lastReadAt,
        daysSinceLastSignIn,
      };
    });
  }),

  adminOverview: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      return {
        totalUsers: 0,
        totalGroups: 0,
        groupedUsers: 0,
        usersWithoutGroup: 0,
        usersNeverRead: 0,
        inactiveUsers7Days: 0,
        inactiveUsers30Days: 0,
      };
    }

    const tenantId = requireTenantAdmin(ctx);

    const tenantUsers = await db
      .select({ id: users.id, lastSignedIn: users.lastSignedIn })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "user")));

    const ids = tenantUsers.map((u) => Number(u.id)).filter(Boolean);
    const [groupTotals] = await db
      .select({ totalGroups: sql<number>`count(*)::int` })
      .from(groups)
      .where(eq(groups.tenantId, tenantId));

    if (!ids.length) {
      return {
        totalUsers: 0,
        totalGroups: Number(groupTotals?.totalGroups ?? 0),
        groupedUsers: 0,
        usersWithoutGroup: 0,
        usersNeverRead: 0,
        inactiveUsers7Days: 0,
        inactiveUsers30Days: 0,
      };
    }

    const membershipRows = await db
      .select({ userId: userGroups.userId })
      .from(userGroups)
      .innerJoin(groups, eq(groups.id, userGroups.groupId))
      .where(and(eq(groups.tenantId, tenantId), inArray(userGroups.userId, ids)));

    const readRows = await db
      .select({ userId: deliveries.userId, readCount: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.isRead, true), inArray(deliveries.userId, ids)))
      .groupBy(deliveries.userId);

    const grouped = new Set(membershipRows.map((r: any) => Number(r.userId)));
    const readMap = new Map(readRows.map((r: any) => [Number(r.userId), Number(r.readCount ?? 0)]));
    const now = Date.now();
    let inactive7 = 0;
    let inactive30 = 0;
    let neverRead = 0;

    for (const user of tenantUsers as any[]) {
      const last = user.lastSignedIn ? new Date(user.lastSignedIn).getTime() : 0;
      const days = last ? Math.floor((now - last) / 86400000) : 999999;
      if (days >= 7) inactive7 += 1;
      if (days >= 30) inactive30 += 1;
      if (!Number(readMap.get(Number(user.id)) ?? 0)) neverRead += 1;
    }

    return {
      totalUsers: ids.length,
      totalGroups: Number(groupTotals?.totalGroups ?? 0),
      groupedUsers: grouped.size,
      usersWithoutGroup: ids.filter((id) => !grouped.has(id)).length,
      usersNeverRead: neverRead,
      inactiveUsers7Days: inactive7,
      inactiveUsers30Days: inactive30,
    };
  }),

  /**
   * Stats do tenant
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db)
      return {
        users: 0,
        notifications: 0,
        groups: 0,
        pendingSchedules: 0,
        deliveriesTotal: 0,
        deliveriesRead: 0,
        readRate: 0,
      };

    try {
      if (ctx.user?.role === "owner") {
        const [userCount] = await db.select({ value: count() }).from(users);
        // Owner usa superadmin.getStats no dashboard; aqui mantemos retorno compatível.
        return {
          users: userCount?.value || 0,
          notifications: 0,
          groups: 0,
          pendingSchedules: 0,
          deliveriesTotal: 0,
          deliveriesRead: 0,
          readRate: 0,
        };
      }

      if (!ctx.user?.tenantId)
        return {
          users: 0,
          notifications: 0,
          groups: 0,
          pendingSchedules: 0,
          deliveriesTotal: 0,
          deliveriesRead: 0,
          readRate: 0,
        };

      const [userCount] = await db
        .select({ value: count() })
        .from(users)
        .where(eq(users.tenantId, ctx.user.tenantId));

      const tenantId = ctx.user.tenantId;

      const [notifCount] = await db
        .select({ value: count() })
        .from(notifications)
        .where(eq(notifications.tenantId, tenantId));

      // "Pendentes" = ativos e com próxima execução agendada no futuro (nextRunAt)
      const [pendingSchedulesCount] = await db
        .select({ value: count() })
        .from(schedules)
        .where(
          and(
            eq(schedules.tenantId, tenantId),
            eq(schedules.isActive, true),
            isNotNull(schedules.nextRunAt),
            gte(schedules.nextRunAt, new Date())
          )
        );

      const [deliveriesTotal] = await db
        .select({ value: count() })
        .from(deliveries)
        .where(eq(deliveries.tenantId, tenantId));

      const [deliveriesRead] = await db
        .select({ value: count() })
        .from(deliveries)
        .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.isRead, true)));

      const total = deliveriesTotal?.value || 0;
      const read = deliveriesRead?.value || 0;
      const readRate = total > 0 ? Math.round((read / total) * 100) : 0;

      return {
        users: userCount?.value || 0,
        notifications: notifCount?.value || 0,
        groups: 0,
        pendingSchedules: pendingSchedulesCount?.value || 0,
        deliveriesTotal: total,
        deliveriesRead: read,
        readRate,
      };
    } catch (error) {
      console.error("[Tenant] Erro ao obter stats:", error);
      return {
        users: 0,
        notifications: 0,
        groups: 0,
        pendingSchedules: 0,
        deliveriesTotal: 0,
        deliveriesRead: 0,
        readRate: 0,
      };
    }
  }),

  /**
   * Logs do tenant (Admin)
   */
  listLogs: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const tenantId = requireTenantAdmin(ctx);

      const data = await db
        .select()
        .from(logs)
        .where(eq(logs.tenantId, tenantId))
        .orderBy(sql`${logs.createdAt} DESC`)
        .limit(input.limit)
        .offset(input.offset);

      const totalRows = await db
        .select({ value: count() })
        .from(logs)
        .where(eq(logs.tenantId, tenantId));

      return { data, total: totalRows?.[0]?.value || 0 };
    }),

  /**
   * ADMIN: criar usuário comum (role=user) no seu tenant
   */
  createUser: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        loginId: z.string().min(3).max(64),
        password: z.string().min(4).max(128),
        email: z.string().email().optional(),
        groupId: z.number().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const tenantId = requireTenantAdmin(ctx);
      const adminId = ctx.user.id;

      const openId = input.loginId.trim().toLowerCase();

      if (!isValidLoginIdOrEmail(openId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Usuário inválido. Use um login (letras/números e ; . _ -) ou um e-mail válido",
        });
      }
      if (!isValidPassword(input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Senha inválida. Use apenas letras, números e ; . _ -",
        });
      }

      const existing = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Usuário já existe" });

      if (input.groupId) {
        const validGroup = await db
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.id, input.groupId),
              eq(groups.tenantId, tenantId),
              eq(groups.createdByAdminId, adminId)
            )
          )
          .limit(1);

        if (!validGroup.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Grupo inválido" });
        }
      }

      const created = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            tenantId,
            createdByAdminId: adminId, // auditoria
            openId,
            name: input.name,
            email: input.email ? input.email.trim().toLowerCase() : null,
            role: "user",
            loginMethod: "local",
            passwordHash: hashPassword(input.password),
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          } as any)
          .returning();

        const newUser = inserted[0];

        if (input.groupId && newUser?.id) {
          await tx.insert(userGroups).values({
            userId: Number(newUser.id),
            groupId: input.groupId,
            createdAt: new Date(),
          });
        }

        return newUser;
      });

      return { success: true, user: created };
    }),

  /**
   * ADMIN: atualizar usuário do tenant (DECISÃO A: qualquer role=user do tenant)
   */
  updateUser: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        email: z.string().email().optional(),
        // ✅ Card informativo persistente e personalizado desse usuário
        announcementEnabled: z.boolean().optional(),
        announcementBody: z.string().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      const patch: any = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.email !== undefined) patch.email = input.email.trim().toLowerCase();
      if (input.announcementEnabled !== undefined) patch.announcementEnabled = input.announcementEnabled;
      if (input.announcementBody !== undefined) patch.announcementBody = input.announcementBody?.trim() || null;

      const updated = await db.update(users).set(patch).where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user"))).returning();
      return { success: true, user: updated[0] };
    }),

  /**
   * ADMIN: remover usuário comum do tenant (DECISÃO A: qualquer role=user do tenant)
   */
  deleteUser: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados não disponível" });

      const tenantId = requireTenantAdmin(ctx);

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      await db.delete(userGroups).where(eq(userGroups.userId, input.id));
      await db.delete(deliveries).where(eq(deliveries.userId, input.id));
      await db.delete(users).where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")));

      return { success: true };
    }),

  /**
   * ADMIN: listar grupos do usuário (para modal "Grupos" no Users)
   */
  getCurrentUserGroups: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db || !ctx.user?.id || !ctx.user?.tenantId) return { groups: [] as Array<{ id: number; name: string; description: string | null }> };

    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
      })
      .from(userGroups)
      .innerJoin(groups, eq(groups.id, userGroups.groupId))
      .where(and(eq(userGroups.userId, ctx.user.id), eq(groups.tenantId, ctx.user.tenantId)));

    return { groups: rows };
  }),

  getUserGroups: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { groupIds: [] as number[] };

      const tenantId = requireTenantAdmin(ctx);
      const adminId = ctx.user.id;

      // valida user no tenant e role=user
      const u = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .limit(1);

      if (!u.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      // pega grupos do user, mas só retorna grupos que pertencem ao tenant do admin E criados pelo admin (mesma regra do groupsRouter)
      const rows = await db
        .select({ groupId: userGroups.groupId })
        .from(userGroups)
        .innerJoin(groups, eq(groups.id, userGroups.groupId))
        .where(
          and(
            eq(userGroups.userId, input.id),
            eq(groups.tenantId, tenantId),
            eq(groups.createdByAdminId, adminId)
          )
        );

      return { groupIds: rows.map((r) => r.groupId) };
    }),

  /**
   * ADMIN: setar grupos do usuário (para modal "Grupos" no Users)
   */
  setUserGroups: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        groupIds: z.array(z.number()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const tenantId = requireTenantAdmin(ctx);
      const adminId = ctx.user.id;

      // valida user no tenant e role=user
      const u = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .limit(1);

      if (!u.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      // valida grupos do tenant do admin e criados pelo admin (igual groupsRouter)
      if (input.groupIds.length) {
        const validGroups = await db
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.tenantId, tenantId),
              eq(groups.createdByAdminId, adminId),
              inArray(groups.id, input.groupIds)
            )
          );

        const validIds = new Set(validGroups.map((g) => g.id));
        const bad = input.groupIds.filter((id) => !validIds.has(id));
        if (bad.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Grupos inválidos" });
      }

      await db.transaction(async (tx) => {
        await tx.delete(userGroups).where(eq(userGroups.userId, input.userId));

        if (input.groupIds.length) {
          await tx.insert(userGroups).values(
            input.groupIds.map((groupId) => ({
              userId: input.userId,
              groupId,
              createdAt: new Date(),
            }))
          );
        }
      });

      return { success: true };
    }),

  /**
   * ADMIN: resetar senha de usuário do tenant (role=user)
   */
  resetUserPassword: adminProcedure
    .input(
      z.object({
        id: z.number(),
        password: z.string().min(4).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const tenantId = requireTenantAdmin(ctx);

      if (!isValidPassword(input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Senha inválida. Use apenas letras, números e ; . _ -",
        });
      }

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      await db
        .update(users)
        .set({
          passwordHash: hashPassword(input.password),
          loginMethod: "local",
          updatedAt: new Date(),
        } as any)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user")));

      return { success: true };
    }),
});
