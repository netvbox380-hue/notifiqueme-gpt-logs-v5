import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { getUserByOpenId, upsertUser } from "../db";
import { ENV } from "../_core/env";
import { TRPCError } from "@trpc/server";
import { ensureTenantAccessOrThrow } from "../_core/tenantAccess";
import {
  isValidLoginIdOrEmail,
  isValidPassword,
  verifyPassword,
} from "../_core/password";
import { assertRateLimit } from "../_core/rateLimit";

/**
 * Cookie para Render/HTTPS:
 * - Prod (https): Secure + SameSite=None
 * - Dev (http): SameSite=Lax
 *
 * Obs: Logout limpa as duas variações, porque às vezes o cookie foi setado
 * com atributos diferentes (proxy/https/local), e aí “sair” não apaga.
 */

type SameSite = "Lax" | "None";

function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  opts?: { secure?: boolean; sameSite?: SameSite }
) {
  const isProd = ENV.isProduction;
  const secure = opts?.secure ?? isProd;
  const sameSite: SameSite = opts?.sameSite ?? (secure ? "None" : "Lax");

  const expires = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();

  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expires}`,
    `SameSite=${sameSite}`,
    `HttpOnly`,
  ];

  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(
  name: string,
  opts?: { secure?: boolean; sameSite?: SameSite }
) {
  const isProd = ENV.isProduction;
  const secure = opts?.secure ?? isProd;
  const sameSite: SameSite = opts?.sameSite ?? (secure ? "None" : "Lax");

  const parts = [
    `${name}=`,
    `Path=/`,
    `Max-Age=0`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `SameSite=${sameSite}`,
    `HttpOnly`,
  ];

  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function requireRes(ctx: any) {
  const res = ctx?.res;
  if (!res || typeof res.setHeader !== "function") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Contexto sem 'res'. Verifique createContext do tRPC/Express (req/res não estão sendo passados).",
    });
  }
  return res as { setHeader: (name: string, value: any) => void };
}

export const authRouter = router({
  login: publicProcedure
    .input(
      z.object({
        loginId: z.string().min(3),
        password: z.string().min(4),
        name: z.string().optional(),
        email: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const res = requireRes(ctx);

      // ✅ fonte única: cookie name vem do SDK (que deve usar ENV.sessionCookieName internamente)
      const cookieName = (sdk as any).COOKIE_NAME
        ? String((sdk as any).COOKIE_NAME)
        : (ENV.sessionCookieName || "app_session_id").trim();

      const openId = input.loginId.trim().toLowerCase();

      await assertRateLimit({
        req: ctx.req,
        key: "auth.login",
        scope: openId,
        limit: 8,
        windowMs: 15 * 60_000,
      });

      if (!isValidLoginIdOrEmail(openId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Usuário inválido. Use login (letras/números e ; . _ -) ou e-mail válido",
        });
      }

      if (!isValidPassword(input.password)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Senha inválida. Use letras, números e caracteres ; . _ -",
        });
      }

      const existing = await getUserByOpenId(openId);
      const now = new Date();

      if (existing) {
        await ensureTenantAccessOrThrow(existing as any);
      }

      // ✅ se existe e tem hash: valida
      if (existing?.passwordHash) {
        const ok = verifyPassword(input.password, existing.passwordHash);
        if (!ok) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Usuário ou senha incorretos",
          });
        }
      }

      // 🛡️ se existe MAS não tem senha: não permitir “tomar conta” do usuário
      if (existing && !existing.passwordHash) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Este usuário ainda não tem senha definida. Peça ao admin/owner para definir ou resetar a senha.",
        });
      }

      if (!existing) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Usuário ou senha incorretos",
        });
      }

      await upsertUser({
        openId,
        name: existing.name ?? input.name ?? null,
        email: existing.email ?? input.email ?? null,
        loginMethod: existing.loginMethod ?? "local",
        lastSignedIn: now,
      } as any);

      // ✅ alinhar duração do token com cookie (30 dias)
      const maxAgeSeconds = 60 * 60 * 24 * 30;
      const token = await sdk.createSessionToken(openId, {
        expiresInMs: maxAgeSeconds * 1000,
      });

      // ✅ Prod: Secure+None | Dev: Lax
      res.setHeader(
        "Set-Cookie",
        buildCookie(cookieName, token, maxAgeSeconds)
      );

      return { success: true };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const res = requireRes(ctx);

    const cookieName = (sdk as any).COOKIE_NAME
      ? String((sdk as any).COOKIE_NAME)
      : (ENV.sessionCookieName || "app_session_id").trim();

    // ✅ limpa em TODOS os casos (resolve “logout não apaga” por atributos diferentes)
    res.setHeader("Set-Cookie", [
      clearCookie(cookieName, { secure: true, sameSite: "None" }),
      clearCookie(cookieName, { secure: false, sameSite: "Lax" }),
    ]);

    return { success: true };
  }),

  me: protectedProcedure.query(({ ctx }) => {
    return { user: ctx.user };
  }),
});
