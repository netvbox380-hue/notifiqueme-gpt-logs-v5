import { z } from "zod";
import { router, ownerProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, notifications, groups, resellers } from "../../drizzle/schema";
import { eq, sql, count, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sanitizeBrandingInput } from "../_core/branding";
import { isValidLoginIdOrEmail, isValidPassword, hashPassword } from "../_core/password";

function normalizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export const superAdminRouter = router({
  /**
   * Estatísticas globais do sistema
   */
  getStats: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Banco de dados não disponível",
      });
    }

    try {
      const [tenantCount] = await db.select({ value: count() }).from(tenants);
      const [userCount] = await db.select({ value: count() }).from(users);
      const [notifCount] = await db.select({ value: count() }).from(notifications);

      return {
        totalTenants: tenantCount?.value || 0,
        totalUsers: userCount?.value || 0,
        totalNotifications: notifCount?.value || 0,
      };
    } catch (error) {
      console.error("[SuperAdmin] Erro ao obter stats:", error);
      return {
        totalTenants: 0,
        totalUsers: 0,
        totalNotifications: 0,
      };
    }
  }),

  /**
   * Listar todos os tenants
   */
  listTenants: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    try {
      return await db.select().from(tenants).orderBy(sql`${tenants.createdAt} DESC`);
    } catch (error) {
      console.error("[SuperAdmin] Erro ao listar tenants:", error);
      return [];
    }
  }),

  /**
   * Criar novo tenant
   */
  createTenant: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1, "Nome é obrigatório"),
        slug: z.string().min(1, "Slug é obrigatório"),
        plan: z.enum(["basic", "pro", "enterprise"]),
        months: z.number().min(1, "Mínimo 1 mês"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const slug = normalizeSlug(input.slug);
      if (!slug) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Slug inválido. Use letras/números e hífen.",
        });
      }

      const existing = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Slug já existe. Escolha outro identificador.",
        });
      }

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
   * Atualizar tenant
   */
  updateTenant: ownerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        status: z.enum(["active", "suspended", "expired"]).optional(),
        plan: z.enum(["basic", "pro", "enterprise"]).optional(),
        months: z.number().optional(),
        brandName: z.string().max(255).nullable().optional(),
        brandLogoUrl: z.string().max(500).nullable().optional(),
        brandPrimaryColor: z.string().max(32).nullable().optional(),
        supportPhone: z.string().max(64).nullable().optional(),
        pixKey: z.string().max(255).nullable().optional(),
        mercadoPagoLink: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      const branding = sanitizeBrandingInput(input);

      if (input.name !== undefined) updateData.name = input.name;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.plan !== undefined) updateData.plan = input.plan;
      if (input.brandName !== undefined) updateData.brandName = branding.brandName ?? null;
      if (input.brandLogoUrl !== undefined) updateData.brandLogoUrl = branding.brandLogoUrl ?? null;
      if (input.brandPrimaryColor !== undefined) updateData.brandPrimaryColor = branding.brandPrimaryColor ?? null;
      if (input.supportPhone !== undefined) updateData.supportPhone = branding.supportPhone ?? null;
      if (input.pixKey !== undefined) updateData.pixKey = branding.pixKey ?? null;
      if (input.mercadoPagoLink !== undefined) updateData.mercadoPagoLink = branding.mercadoPagoLink ?? null;

      if (input.months) {
        const tenant = await db.select().from(tenants).where(eq(tenants.id, input.id)).limit(1);

        if (tenant.length > 0) {
          const currentExpiry = tenant[0].subscriptionExpiresAt
            ? new Date(tenant[0].subscriptionExpiresAt)
            : new Date();
          const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
          const newExpiry = new Date(baseDate);
          newExpiry.setMonth(newExpiry.getMonth() + input.months);
          updateData.subscriptionExpiresAt = newExpiry;
        }
      }

      await db.update(tenants).set(updateData).where(eq(tenants.id, input.id));
      return { success: true };
    }),

  /**
   * Deletar tenant
   */
  deleteTenant: ownerProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      await db.update(users).set({ tenantId: null, role: "user" }).where(eq(users.tenantId, input));
      await db.delete(tenants).where(eq(tenants.id, input));

      return { success: true };
    }),

  /**
   * Definir data de vencimento (campo direto)
   */
  setExpiryDate: ownerProcedure
    .input(
      z.object({
        id: z.number(),
        expiresAt: z.string().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Data de vencimento inválida",
        });
      }

      const now = new Date();
      const status = expiresAt && expiresAt > now ? "active" : undefined;

      await db
        .update(tenants)
        .set({
          subscriptionExpiresAt: expiresAt,
          ...(status ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, input.id));

      return { success: true };
    }),

  /**
   * Listar admins e revendas
   */
  listAdmins: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    try {
      return await db
        .select()
        .from(users)
        .where(or(eq(users.role, "admin"), eq(users.role, "reseller")))
        .orderBy(sql`${users.createdAt} DESC`);
    } catch (error) {
      console.error("[SuperAdmin] Erro ao listar admins:", error);
      return [];
    }
  }),

  /**
   * Listar todos os usuários
   */
  listAllUsers: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    try {
      return await db.select().from(users).orderBy(sql`${users.createdAt} DESC`);
    } catch (error) {
      console.error("[SuperAdmin] Erro ao listar usuários:", error);
      return [];
    }
  }),

  /**
   * Criar admin/revenda
   */
  createAdmin: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1, "Nome é obrigatório"),
        tenantId: z.number().positive("Tenant é obrigatório").optional(),
        loginId: z.string().min(3).max(64),
        password: z.string().min(4).max(128),
        email: z.string().email("Email inválido").optional(),
        role: z.enum(["admin", "reseller"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const targetRole = input.role || "admin";

      if (targetRole !== "reseller") {
        if (!input.tenantId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tenant é obrigatório",
          });
        }

        const tenant = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
        if (tenant.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tenant não encontrado",
          });
        }
      }

      const openId = input.loginId.trim().toLowerCase();
      const email = input.email ? input.email.trim().toLowerCase() : null;

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

      const existing = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

      if (existing.length > 0) {
        await db
          .update(users)
          .set({
            role: targetRole as any,
            tenantId: targetRole === "reseller" ? null : input.tenantId!,
            name: input.name,
            email: email ?? existing[0].email,
            passwordHash: existing[0].passwordHash ?? hashPassword(input.password),
            updatedAt: new Date(),
          })
          .where(eq(users.openId, openId));

        if (targetRole === "reseller") {
          const existingReseller = await db
            .select()
            .from(resellers)
            .where(eq(resellers.userId, existing[0].id))
            .limit(1);

          if (!existingReseller.length) {
            await db.insert(resellers).values({
              name: input.name,
              slug: openId.replace(/[^a-z0-9-_.]/g, "-").slice(0, 100),
              userId: existing[0].id,
            });
          }
        } else {
          await db.delete(resellers).where(eq(resellers.userId, existing[0].id));
        }

        return { success: true, userId: existing[0].id, updated: true };
      }

      const result = await db
        .insert(users)
        .values({
          openId,
          email,
          name: input.name,
          role: targetRole as any,
          tenantId: targetRole === "reseller" ? null : input.tenantId!,
          loginMethod: "local",
          passwordHash: hashPassword(input.password),
        })
        .returning({ id: users.id });

      if (targetRole === "reseller") {
        await db.insert(resellers).values({
          name: input.name,
          slug: openId.replace(/[^a-z0-9-_.]/g, "-").slice(0, 100),
          userId: result[0]?.id || 0,
        });
      }

      return { success: true, userId: result[0]?.id || 0, updated: false };
    }),

  /**
   * Atualizar admin/revenda
   */
  updateAdmin: ownerProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        tenantId: z.number().nullable().optional(),
        role: z.enum(["user", "admin", "reseller"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const current = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      if (!current.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Usuário não encontrado",
        });
      }

      const nextRole = input.role ?? current[0].role;
      const nextTenantId =
        nextRole === "reseller"
          ? null
          : input.tenantId !== undefined
            ? input.tenantId
            : current[0].tenantId;

      if (nextRole !== "reseller" && !nextTenantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tenant é obrigatório para admin",
        });
      }

      if (nextRole !== "reseller" && nextTenantId !== null) {
        const tenant = await db.select().from(tenants).where(eq(tenants.id, nextTenantId)).limit(1);
        if (tenant.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Tenant não encontrado",
          });
        }
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
        role: nextRole,
        tenantId: nextRole === "reseller" ? null : nextTenantId,
      };

      if (input.name) updateData.name = input.name;

      await db.update(users).set(updateData).where(eq(users.id, input.id));

      if (nextRole === "reseller") {
        const existingReseller = await db
          .select()
          .from(resellers)
          .where(eq(resellers.userId, input.id))
          .limit(1);

        if (!existingReseller.length) {
          await db.insert(resellers).values({
            userId: input.id,
            name: input.name || current[0].name || current[0].openId,
            slug: String(current[0].openId || `reseller-${input.id}`)
              .replace(/[^a-z0-9-_.]/g, "-")
              .slice(0, 100),
          });
        }
      } else {
        await db.delete(resellers).where(eq(resellers.userId, input.id));
      }

      return { success: true };
    }),

  /**
   * Deletar admin/revenda (rebaixa para user)
   */
  deleteAdmin: ownerProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      await db
        .update(users)
        .set({ role: "user", tenantId: null, updatedAt: new Date() })
        .where(eq(users.id, input));

      await db.delete(resellers).where(eq(resellers.userId, input));

      return { success: true };
    }),

  /**
   * Promover usuário a admin de um tenant
   */
  promoteToAdmin: ownerProcedure
    .input(
      z.object({
        userId: z.number(),
        tenantId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const tenant = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (tenant.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tenant não encontrado",
        });
      }

      await db
        .update(users)
        .set({ role: "admin", tenantId: input.tenantId, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

      await db.delete(resellers).where(eq(resellers.userId, input.userId));

      return { success: true };
    }),

  /**
   * Owner: listar users por tenant
   */
  listUsersByTenant: ownerProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const data = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          tenantId: users.tenantId,
          createdByAdminId: users.createdByAdminId,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.tenantId, input.tenantId))
        .orderBy(sql`${users.createdAt} DESC`);

      return { data };
    }),

  /**
   * Owner: listar grupos por tenant
   */
  listGroupsByTenant: ownerProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco de dados não disponível",
        });
      }

      const data = await db
        .select()
        .from(groups)
        .where(eq(groups.tenantId, input.tenantId))
        .orderBy(sql`${groups.createdAt} DESC`);

      return { data };
    }),
});