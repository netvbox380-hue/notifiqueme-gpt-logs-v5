import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { getUserByOpenId } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;

  // ✅ Nome do cookie de sessão (debug/consistência)
  sessionCookieName: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // ✅ fonte única (mantém compatibilidade)
  const sessionCookieName =
    (ENV.sessionCookieName || (sdk as any).COOKIE_NAME || "app_session_id").trim();

  // 🔎 Evita chamadas desnecessárias
  const hasCookieHeader = Boolean(opts.req.headers.cookie);

  if (hasCookieHeader) {
    try {
      const auth = await sdk.authenticateRequest(opts.req);

      if (auth?.openId) {
        // ✅ buscar usuário real no DB
        user = await getUserByOpenId(auth.openId);
      }
    } catch (error) {
      user = null;

      if (!ENV.isProduction) {
        console.warn("[Auth] Context auth failed:", {
          message: String(error),
          hasCookieHeader: true,
          sessionCookieName,
        });
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    sessionCookieName,
  };
}
