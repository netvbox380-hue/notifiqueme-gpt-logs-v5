import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, resellers } from "../../drizzle/schema";
import { and, eq, sql, or, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sanitizeBrandingInput } from "../_core/branding";
import { hashPassword, isValidLoginIdOrEmail, isValidPassword } from "../_core/password";
import { assertUserInScopeOrThrow } from "../_core/ownership";

async function getCurrentResellerOrThrow(ctx: any) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.user.role !== "reseller") throw new TRPCError({ code: "FORBIDDEN", message: "RESELLER_ONLY" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
  const found = await db.select().from(resellers).where(eq(resellers.userId, ctx.user.id)).limit(1);
  if (!found.length) throw new TRPCError({ code: "FORBIDDEN", message: "Revenda não encontrada" });
  return { db, reseller: found[0] };
}

async function assertTenantBelongsToReseller(db: any, resellerId: number, tenantId: number) {
  const found = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.resellerId as any, resellerId)))
    .limit(1);
  if (!found.length) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não pertence à sua revenda" });
}

export const resellerRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "reseller") return null;
    const { reseller } = await getCurrentResellerOrThrow(ctx);
    return reseller;
  }),

  getStats: protectedProcedure.query(async ({ ctx }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    const tenantCount = await db.select({ count: sql<number>`count(*)` }).from(tenants).where(eq(tenants.resellerId as any, reseller.id));
    const userCount = await db.select({ count: sql<number>`count(*)` }).from(users).leftJoin(tenants, eq(users.tenantId, tenants.id)).where(and(or(eq(users.role, "admin"), eq(users.role, "user")), eq(tenants.resellerId as any, reseller.id)));
    return { totalTenants: Number(tenantCount?.[0]?.count ?? 0), totalUsers: Number(userCount?.[0]?.count ?? 0), totalNotifications: 0 };
  }),

  listTenants: protectedProcedure.query(async ({ ctx }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    return db.select().from(tenants).where(eq(tenants.resellerId as any, reseller.id)).orderBy(desc(tenants.createdAt));
  }),

  createTenant: protectedProcedure.input(z.object({ name: z.string().min(1), slug: z.string().min(2), plan: z.enum(["basic","pro","enterprise"]).default("basic"), months: z.number().min(1).max(60).default(1) })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    const expiry = new Date(); expiry.setMonth(expiry.getMonth() + input.months);
    const created = await db.insert(tenants).values({ name: input.name, slug: input.slug, plan: input.plan, resellerId: reseller.id as any, status: "active", subscriptionExpiresAt: expiry }).returning({ id: tenants.id });
    return { success: true, id: created[0]?.id };
  }),

  updateTenant: protectedProcedure.input(z.object({ id: z.number(), name: z.string().optional(), plan: z.enum(["basic","pro","enterprise"]).optional(), status: z.enum(["active","suspended","expired"]).optional(), brandName: z.string().max(255).nullable().optional(), brandLogoUrl: z.string().max(500).nullable().optional(), brandPrimaryColor: z.string().max(32).nullable().optional(), supportPhone: z.string().max(64).nullable().optional(), pixKey: z.string().max(255).nullable().optional(), mercadoPagoLink: z.string().max(500).nullable().optional() })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    await assertTenantBelongsToReseller(db, reseller.id, input.id);
    const patch: any = { updatedAt: new Date() };
    const branding = sanitizeBrandingInput(input);
    if (input.name !== undefined) patch.name = input.name;
    if (input.plan !== undefined) patch.plan = input.plan;
    if (input.status !== undefined) patch.status = input.status;
    if (input.brandName !== undefined) patch.brandName = branding.brandName ?? null;
    if (input.brandLogoUrl !== undefined) patch.brandLogoUrl = branding.brandLogoUrl ?? null;
    if (input.brandPrimaryColor !== undefined) patch.brandPrimaryColor = branding.brandPrimaryColor ?? null;
    if (input.supportPhone !== undefined) patch.supportPhone = branding.supportPhone ?? null;
    if (input.pixKey !== undefined) patch.pixKey = branding.pixKey ?? null;
    if (input.mercadoPagoLink !== undefined) patch.mercadoPagoLink = branding.mercadoPagoLink ?? null;
    await db.update(tenants).set(patch).where(and(eq(tenants.id, input.id), eq(tenants.resellerId as any, reseller.id)));
    return { success: true };
  }),

  deleteTenant: protectedProcedure.input(z.number()).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    await assertTenantBelongsToReseller(db, reseller.id, input);
    await db.update(users).set({ tenantId: null, role: "user", updatedAt: new Date() }).where(eq(users.tenantId, input));
    await db.delete(tenants).where(and(eq(tenants.id, input), eq(tenants.resellerId as any, reseller.id)));
    return { success: true };
  }),

  setExpiryDate: protectedProcedure.input(z.object({ id: z.number(), expiresAt: z.string().nullable() })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    await assertTenantBelongsToReseller(db, reseller.id, input.id);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    await db.update(tenants).set({ subscriptionExpiresAt: expiresAt, updatedAt: new Date() }).where(and(eq(tenants.id, input.id), eq(tenants.resellerId as any, reseller.id)));
    return { success: true };
  }),

  renewSubscription: protectedProcedure
    .input(z.object({ tenantId: z.number(), months: z.number().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const { db, reseller } = await getCurrentResellerOrThrow(ctx);
      await assertTenantBelongsToReseller(db, reseller.id, input.tenantId);
      const result = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });
      const tenant = result[0];
      const currentExpiry = tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt) : new Date();
      const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
      const newExpiry = new Date(baseDate);
      newExpiry.setMonth(newExpiry.getMonth() + input.months);
      await db.update(tenants).set({ subscriptionExpiresAt: newExpiry, status: "active", updatedAt: new Date() }).where(and(eq(tenants.id, input.tenantId), eq(tenants.resellerId as any, reseller.id)));
      return { success: true, newExpiry };
    }),


  listAdmins: protectedProcedure.query(async ({ ctx }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    return db.select({ id: users.id, openId: users.openId, name: users.name, email: users.email, role: users.role, tenantId: users.tenantId, createdAt: users.createdAt, updatedAt: users.updatedAt, lastSignedIn: users.lastSignedIn }).from(users).leftJoin(tenants, eq(users.tenantId, tenants.id)).where(and(eq(users.role, "admin"), eq(tenants.resellerId as any, reseller.id))).orderBy(desc(users.createdAt));
  }),

  createAdmin: protectedProcedure.input(z.object({ name: z.string().min(1), tenantId: z.number().optional(), loginId: z.string().min(3).max(64), password: z.string().min(4).max(128), email: z.string().email().optional(), role: z.enum(["admin"]).optional() })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    if (!input.tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um tenant" });
    await assertTenantBelongsToReseller(db, reseller.id, input.tenantId);
    const openId = input.loginId.trim().toLowerCase();
    if (!isValidLoginIdOrEmail(openId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Login inválido" });
    if (!isValidPassword(input.password)) throw new TRPCError({ code: "BAD_REQUEST", message: "Senha inválida" });
    const existing = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Usuário já existe" });
    const result = await db.insert(users).values({ openId, email: input.email ? input.email.trim().toLowerCase() : null, name: input.name, role: "admin", tenantId: input.tenantId, loginMethod: "local", passwordHash: hashPassword(input.password) }).returning({ id: users.id });
    return { success: true, userId: result[0]?.id || 0 };
  }),

  updateAdmin: protectedProcedure.input(z.object({ id: z.number(), name: z.string().optional(), email: z.string().email().optional(), tenantId: z.number().optional(), role: z.enum(["admin"]).optional() })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    const target = await assertUserInScopeOrThrow(db, ctx.user, input.id, ["admin"]);
    if (target.tenantId) await assertTenantBelongsToReseller(db, reseller.id, target.tenantId as number);
    if (input.tenantId) await assertTenantBelongsToReseller(db, reseller.id, input.tenantId);
    const patch: any = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email.trim().toLowerCase();
    if (input.tenantId !== undefined) patch.tenantId = input.tenantId;
    await db.update(users).set(patch).where(and(eq(users.id, input.id), eq(users.role, "admin")));
    return { success: true };
  }),

  resetAdminPassword: protectedProcedure.input(z.object({ id: z.number(), password: z.string().min(4).max(128) })).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    const target = await assertUserInScopeOrThrow(db, ctx.user, input.id, ["admin"]);
    if (target.tenantId) await assertTenantBelongsToReseller(db, reseller.id, target.tenantId as number);
    await db.update(users).set({ passwordHash: hashPassword(input.password), updatedAt: new Date() }).where(and(eq(users.id, input.id), eq(users.role, "admin")));
    return { success: true };
  }),

  deleteAdmin: protectedProcedure.input(z.number()).mutation(async ({ ctx, input }) => {
    const { db, reseller } = await getCurrentResellerOrThrow(ctx);
    const target = await assertUserInScopeOrThrow(db, ctx.user, input, ["admin"]);
    if (target.tenantId) await assertTenantBelongsToReseller(db, reseller.id, target.tenantId as number);
    await db.update(users).set({ role: "user", tenantId: null, updatedAt: new Date() }).where(and(eq(users.id, input), eq(users.role, "admin")));
    return { success: true };
  }),
});
