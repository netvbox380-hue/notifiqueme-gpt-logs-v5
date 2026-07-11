import { initTRPC, TRPCError } from "@trpc/server";
import type { inferAsyncReturnType } from "@trpc/server";
import superjson from "superjson";

import { createContext } from "./context";
import { ensureTenantAccessOrThrow } from "./tenantAccess";

export type TrpcContext = inferAsyncReturnType<typeof createContext>;

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/**
 * Fonte única de autenticação:
 * - ctx.user (setado no createContext via sdk.authenticateRequest)
 */
function requireUser(ctx: TrpcContext) {
  const user = ctx.user;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
  }
  return user;
}

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const user = requireUser(ctx);
  await ensureTenantAccessOrThrow(user as any);
  return next({
    ctx: { ...ctx, user }, // ✅ garante ctx.user sempre presente
  });
});

export const adminOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  const user = requireUser(ctx);

  // ✅ owner normalmente pode tudo que admin pode
  if (user.role !== "admin" && user.role !== "owner" && user.role !== "reseller") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Apenas admin/owner" });
  }

  return next({ ctx });
});

export const ownerOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  const user = requireUser(ctx);

  if (user.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Apenas owner" });
  }

  return next({ ctx });
});

// Aliases de compatibilidade (seu projeto importa esses nomes)
export const adminProcedure = adminOnlyProcedure;
export const ownerProcedure = ownerOnlyProcedure;
