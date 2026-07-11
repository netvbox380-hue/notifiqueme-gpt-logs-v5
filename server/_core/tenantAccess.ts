import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { tenants } from "../../drizzle/schema";
import { getDb } from "../db";

export async function getTenantStatusInfo(tenantId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      status: tenants.status,
      subscriptionExpiresAt: tenants.subscriptionExpiresAt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const tenant = rows[0];
  if (!tenant) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant não encontrado" });

  const now = new Date();
  const expiresAt = tenant.subscriptionExpiresAt ? new Date(tenant.subscriptionExpiresAt) : null;
  const expiredByDate = Boolean(expiresAt && expiresAt.getTime() < now.getTime());
  const effectiveStatus = expiredByDate ? "expired" : tenant.status;

  if (expiredByDate && tenant.status !== "expired") {
    await db.update(tenants).set({ status: "expired", updatedAt: now }).where(eq(tenants.id, tenantId));
  }

  return {
    ...tenant,
    effectiveStatus,
    isExpired: effectiveStatus === "expired",
    isSuspended: effectiveStatus === "suspended",
  };
}

export async function ensureTenantAccessOrThrow(user: { role?: string | null; tenantId?: number | null }) {
  if (!user || user.role === "owner" || user.role === "reseller") return;
  if (!user.tenantId) return;

  const info = await getTenantStatusInfo(Number(user.tenantId));
  if (info.effectiveStatus === "expired") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Plano expirado. Renove a assinatura para continuar usando o painel.",
    });
  }
  if (info.effectiveStatus === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tenant suspenso. Regularize o plano para reativar o acesso.",
    });
  }
}
