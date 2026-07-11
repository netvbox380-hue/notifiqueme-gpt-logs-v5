import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { resellers, tenants, users } from "../../drizzle/schema";

export async function getResellerIdForUser(db: any, userId: number): Promise<number> {
  const found = await db
    .select({ id: resellers.id })
    .from(resellers)
    .where(eq(resellers.userId, userId))
    .limit(1);

  const resellerId = found?.[0]?.id;
  if (!resellerId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Revenda não encontrada" });
  }
  return Number(resellerId);
}

export async function assertTenantInScopeOrThrow(db: any, user: any, tenantId: number) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

  if (user.role === "owner") {
    const found = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!found.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant não encontrado" });
    return;
  }

  if (user.role === "reseller") {
    const resellerId = await getResellerIdForUser(db, Number(user.id));
    const found = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.resellerId as any, resellerId)))
      .limit(1);
    if (!found.length) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Tenant fora do escopo da revenda" });
    }
    return;
  }

  if (!user.tenantId || Number(user.tenantId) !== Number(tenantId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant fora do seu escopo" });
  }
}

export async function assertUserInScopeOrThrow(db: any, actor: any, targetUserId: number, allowedRoles?: string[]) {
  if (!actor) throw new TRPCError({ code: "UNAUTHORIZED" });

  const found = await db
    .select({ id: users.id, tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  const target = found?.[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
  if (allowedRoles?.length && !allowedRoles.includes(String(target.role))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tipo de usuário não permitido" });
  }
  if (target.tenantId == null) {
    if (actor.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Usuário sem tenant fora do seu escopo" });
    }
    return target;
  }

  await assertTenantInScopeOrThrow(db, actor, Number(target.tenantId));
  return target;
}
