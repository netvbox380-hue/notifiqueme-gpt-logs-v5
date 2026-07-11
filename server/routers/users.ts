// server/routers/users.ts
import { z } from "zod";
import { router, adminOnlyProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { users, deliveries, userGroups } from "../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { hashPassword, isValidLoginIdOrEmail, isValidPassword } from "../_core/password";
import { getTenantPlanLimits } from "../_core/credits";

function requireAdminTenant(ctx: any) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "UNAUTHED" });

  // aqui é EXCLUSIVO para ADMIN (owner não usa esses endpoints)
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "ADMIN_ONLY" });

  if (!ctx.user.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });

  return { tenantId: ctx.user.tenantId as number, adminId: ctx.user.id as number };
}

export const usersRouter = router({
  /**
   * ADMIN: listar users do próprio tenant (somente os criados por este admin)
   */
  list: adminOnlyProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
        q: z.string().optional(), // busca por nome/email/openId
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], total: 0 };

      const { tenantId, adminId } = requireAdminTenant(ctx);

      const q = input.q?.trim().toLowerCase();
      const whereBase = and(eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, adminId));

      const where =
        q && q.length
          ? and(
              whereBase,
              sql`(
                lower(${users.openId}) like ${"%" + q + "%"} OR
                lower(coalesce(${users.name}, '')) like ${"%" + q + "%"} OR
                lower(coalesce(${users.email}, '')) like ${"%" + q + "%"}
              )`
            )
          : whereBase;

      const data = await db
        .select({
          id: users.id,
          openId: users.openId,
          name: users.name,
          email: users.email,
          role: users.role,
          tenantId: users.tenantId,
          createdByAdminId: users.createdByAdminId,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastSignedIn: users.lastSignedIn,
        })
        .from(users)
        .where(where as any)
        .orderBy(sql`${users.id} DESC`)
        .limit(input.limit)
        .offset(input.offset);

      const totalRows = await db.select({ count: sql<number>`count(*)` }).from(users).where(where as any);

      return { data, total: Number(totalRows?.[0]?.count ?? 0) };
    }),

  /**
   * ADMIN: criar user comum (role=user) no próprio tenant
   */
  create: adminOnlyProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        loginId: z.string().min(3).max(64),
        password: z.string().min(4).max(128),
        email: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const { tenantId, adminId } = requireAdminTenant(ctx);

      const { limits, plan } = await getTenantPlanLimits(tenantId);
      const currentUsers = await db.select({ count: sql<number>`count(*)` }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, "user")));
      const userCount = Number(currentUsers?.[0]?.count ?? 0);
      if (userCount >= limits.maxUsers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Seu plano ${String(plan).toUpperCase()} permite até ${limits.maxUsers} usuários. Faça upgrade para continuar.`,
        });
      }

      const openId = input.loginId.trim().toLowerCase();

      if (!isValidLoginIdOrEmail(openId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Usuário inválido. Use login (letras/números e ; . _ -) ou e-mail válido",
        });
      }

      if (!isValidPassword(input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Senha inválida. Use letras, números e caracteres ; . _ -",
        });
      }

      // openId é UNIQUE global
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1);
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Usuário já existe" });

      // email duplicado (global) - mantenha se isso for regra do seu sistema
      if (input.email) {
        const email = input.email.trim().toLowerCase();
        const emailDup = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (emailDup.length) throw new TRPCError({ code: "CONFLICT", message: "Email já existe" });
      }

      const now = new Date();

      const inserted = await db
        .insert(users)
        .values({
          tenantId,
          createdByAdminId: adminId,
          openId,
          name: input.name,
          email: input.email ? input.email.trim().toLowerCase() : null,
          role: "user",
          loginMethod: "local",
          passwordHash: hashPassword(input.password),
          createdAt: now,
          updatedAt: now,
          // ✅ não marcar como “logou”
          // lastSignedIn: null (se aceitar) — se não aceitar, simplesmente não seta
        } as any)
        .returning({
          id: users.id,
          openId: users.openId,
          name: users.name,
          email: users.email,
          role: users.role,
          tenantId: users.tenantId,
          createdByAdminId: users.createdByAdminId,
          createdAt: users.createdAt,
        });

      return { success: true, user: inserted[0] };
    }),

  /**
   * ADMIN: atualizar user comum do próprio tenant (somente os criados por este admin)
   */
  update: adminOnlyProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        email: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const { tenantId, adminId } = requireAdminTenant(ctx);

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, adminId)))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      const patch: any = { updatedAt: new Date() };

      if (input.name !== undefined) patch.name = input.name;

      if (input.email !== undefined) {
        const email = input.email.trim().toLowerCase();

        const emailDup = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), sql`${users.id} <> ${input.id}`))
          .limit(1);

        if (emailDup.length) throw new TRPCError({ code: "CONFLICT", message: "Email já existe" });

        patch.email = email;
      }

      const updated = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, input.id))
        .returning({
          id: users.id,
          openId: users.openId,
          name: users.name,
          email: users.email,
          role: users.role,
          tenantId: users.tenantId,
          createdByAdminId: users.createdByAdminId,
          updatedAt: users.updatedAt,
        });

      return { success: true, user: updated[0] };
    }),

  /**
   * ADMIN: resetar senha do user (somente os criados por este admin)
   */
  resetPassword: adminOnlyProcedure
    .input(z.object({ id: z.number(), newPassword: z.string().min(4).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const { tenantId, adminId } = requireAdminTenant(ctx);

      if (!isValidPassword(input.newPassword)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Senha inválida. Use letras, números e caracteres ; . _ -",
        });
      }

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, adminId)))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      await db.update(users).set({ passwordHash: hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, input.id));

      return { success: true };
    }),

  /**
   * ADMIN: deletar user (somente os criados por este admin)
   */
  delete: adminOnlyProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const { tenantId, adminId } = requireAdminTenant(ctx);

      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, adminId)))
        .limit(1);

      if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });

      await db.delete(userGroups).where(eq(userGroups.userId, input.id));
      await db.delete(deliveries).where(eq(deliveries.userId, input.id));
      await db.delete(users).where(eq(users.id, input.id));

      return { success: true };
    }),

  /**
   * ADMIN: listar ids dos users (helper para UI selects)
   */
  listIds: adminOnlyProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { data: [] as { id: number; name: string | null; openId: string }[] };

    const { tenantId, adminId } = requireAdminTenant(ctx);

    const data = await db
      .select({ id: users.id, name: users.name, openId: users.openId })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "user"), eq(users.createdByAdminId, adminId)))
      .orderBy(sql`${users.id} DESC`);

    return { data };
  }),
});
