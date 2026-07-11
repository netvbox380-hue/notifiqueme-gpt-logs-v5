// server/_core/sdk.ts
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

type CreateTokenOptions = {
  expiresInMs?: number; // default 30d
};

// ✅ fonte única de cookie name
export const COOKIE_NAME = (ENV.sessionCookieName || "app_session_id").trim();

function getJwtSecretKey() {
  const secret = ENV.sessionSecret;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET não está definido (ENV.sessionSecret). Configure a variável de ambiente de sessão."
    );
  }
  return new TextEncoder().encode(secret);
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;

  // "a=b; c=d"
  const parts = cookieHeader.split(";");
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;

    const idx = part.indexOf("=");
    if (idx === -1) continue;

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;

    try {
      map[key] = decodeURIComponent(value);
    } catch {
      map[key] = value;
    }
  }

  return map;
}

async function verifySessionToken(token: string) {
  const key = getJwtSecretKey();

  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
  });

  const openId = typeof payload.sub === "string" ? payload.sub : null;
  if (!openId) throw new Error("Invalid session token: missing subject (sub)");

  return {
    openId,
    payload,
  };
}

async function createSessionToken(openId: string, opts?: CreateTokenOptions) {
  const key = getJwtSecretKey();

  const expiresInMs = opts?.expiresInMs ?? 1000 * 60 * 60 * 24 * 30; // 30d
  const now = Date.now();
  const exp = Math.floor((now + expiresInMs) / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(openId)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(exp)
    .sign(key);
}

/**
 * Retorna { openId } ou null.
 * (Compatível com o fluxo atual do seu context.ts)
 */
async function authenticateRequest(req: Request) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = cookies[COOKIE_NAME];

  if (!token) return null;

  const { openId } = await verifySessionToken(token);
  return { openId };
}

export const sdk = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  authenticateRequest,
};
