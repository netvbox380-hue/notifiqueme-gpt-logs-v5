import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Readable } from "stream";

import { getDb } from "../db";
import { files, deliveries } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { storageGet } from "../storage";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { assertTenantInScopeOrThrow } from "./ownership";

import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV } from "./env";

function normalizeOrigin(origin: string) {
  return origin.replace(/\/$/, "");
}

function isPrivateLanOrigin(o: string) {
  // Ex.: http://192.168.0.12:8888
  return (
    /^https?:\/\/192\.168\./.test(o) ||
    /^https?:\/\/10\./.test(o) ||
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\./.test(o) ||
    /^https?:\/\/[\w-]+\.local(?::\d+)?$/.test(o)
  );
}

/**
 * Cria o app Express SEM dar listen().
 * - Usado pelo Render (index.ts dá listen)
 * - Usado pelo Netlify Functions (serverless-http)
 */
export async function createApp() {
  const app = express();

  // Em produção, não deixa subir sem segredos
  if (ENV.isProduction) {
    if (!ENV.cookieSecret) {
      throw new Error("[ENV] COOKIE_SECRET não definido em produção.");
    }
    if (!ENV.jwtSecret) {
      throw new Error("[ENV] JWT_SECRET não definido em produção.");
    }
  }

  // Healthcheck simples
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  // Body
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Cookies
  app.use(cookieParser(ENV.cookieSecret || "dev-cookie-secret"));

  // CORS somente para API (quando front e api estão em domínios diferentes)
  const allowedOrigins = new Set<string>();

  // Dev
  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://localhost:8888");
  allowedOrigins.add("http://127.0.0.1:5173");
  allowedOrigins.add("http://127.0.0.1:3000");
  allowedOrigins.add("http://127.0.0.1:8888");

  const extraOrigins = String(
    process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || ""
  )
    .split(",")
    .map((v) => normalizeOrigin(v.trim()))
    .filter(Boolean);

  for (const origin of extraOrigins) allowedOrigins.add(origin);

  // Produção / domínio configurado (se existir)
  if (ENV.appUrl) allowedOrigins.add(normalizeOrigin(ENV.appUrl));

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const o = normalizeOrigin(origin);

      // ✅ Dev em rede local (celular)
      if (!ENV.isProduction && isPrivateLanOrigin(o)) return callback(null, true);

      if (allowedOrigins.has(o)) return callback(null, true);

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-cron-secret",
      "x-trpc-batch",
      "x-trpc-source",
      "trpc-accept",
    ],
  };

  // Preflight (Render usa /api/trpc, Netlify pode chegar como /trpc)
  app.options("/api/trpc", cors(corsOptions));
  app.options("/api/trpc/*", cors(corsOptions));
  app.options("/trpc", cors(corsOptions));
  app.options("/trpc/*", cors(corsOptions));


  /**
   * ✅ Proxy de mídia (principalmente vídeos)
   * - Evita problemas de CORS/Range no S3 (HTML5 video precisa de Range)
   * - Mantém auth/tenant/entrega (deliveries) no backend
   *
   * Uso: /api/media?fileKey=uploads/...
   */
  const mediaHandler = async (req: express.Request, res: express.Response) => {
    try {
      const ctx = await createContext({ req, res });

      if (!ctx.user) {
        return res.status(401).json({ error: "Não autenticado" });
      }

      const fileKey = String(req.query.fileKey || "").trim();

      if (!fileKey || !fileKey.startsWith("uploads/")) {
        return res.status(400).json({ error: "fileKey inválido" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Banco indisponível" });

      const row = (
        await db.select().from(files).where(eq(files.fileKey, fileKey)).limit(1)
      )?.[0];

      if (!row) return res.status(404).json({ error: "Arquivo não encontrado" });

      const role = ctx.user.role;

      // owner: ok
      if (role === "reseller") {
        await assertTenantInScopeOrThrow(db, ctx.user, Number(row.tenantId));
      }

      if (role === "admin") {
        if (!ctx.user.tenantId || Number(row.tenantId) !== Number(ctx.user.tenantId)) {
          return res.status(403).json({ error: "Sem acesso" });
        }
      }

      if (role === "user") {
        if (!ctx.user.tenantId || Number(row.tenantId) !== Number(ctx.user.tenantId)) {
          return res.status(403).json({ error: "Sem acesso" });
        }

        const canDirect = Number(row.uploadedBy) === Number(ctx.user.id);

        if (!canDirect) {
          if (!row.relatedNotificationId) {
            return res
              .status(403)
              .json({ error: "Sem acesso (arquivo sem notificação vinculada)" });
          }

          const hasAccess = await db
            .select({ id: deliveries.id })
            .from(deliveries)
            .where(
              and(
                eq(deliveries.notificationId, row.relatedNotificationId),
                eq(deliveries.userId, ctx.user.id)
              )
            )
            .limit(1);

          if (!hasAccess.length) {
            return res.status(403).json({ error: "Sem acesso" });
          }
        }
      }

      const got = await storageGet(row.fileKey);

      // modo local: redireciona para o static (que suporta Range automaticamente)
      if (got.url.startsWith("/uploads/")) {
        return res.redirect(got.url);
      }

      // bucket sem suporte local no netlify: retorna erro claro
      if (got.url.startsWith("/uploads-unavailable/")) {
        return res.status(412).json({ error: "Uploads locais indisponíveis no Netlify." });
      }

      // proxy (S3 signed URL) com suporte a Range
      const headers: Record<string, string> = {};
      const range = req.headers.range;
      if (typeof range === "string" && range) headers["Range"] = range;

      const upstream = await fetch(got.url, { headers });

      res.status(upstream.status);

      // repassa headers importantes p/ video
      const passthrough = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "etag",
        "last-modified",
      ];

      for (const h of passthrough) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) return res.end();

      // ✅ Compat: dependendo do runtime, `fetch()` pode devolver
      // Web ReadableStream (undici) OU Node.js Readable.
      // Se tentarmos `Readable.fromWeb()` num Node stream, explode e vira 500.
      const body: any = upstream.body as any;

      // Node.js Readable
      if (body && typeof body.pipe === "function") {
        body.pipe(res);
        return;
      }

      // Web ReadableStream
      if (typeof (Readable as any).fromWeb === "function") {
        (Readable as any).fromWeb(body).pipe(res);
        return;
      }

      // Fallback extremo (não ideal para vídeos grandes, mas evita 500)
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    } catch (e) {
      console.error("[media proxy] error:", e);
      return res.status(500).json({ error: "Falha ao carregar mídia" });
    }
  };

  // Netlify Functions: basePath "/.netlify/functions/api" => rota fica "/media"
  app.get("/media", mediaHandler);
  // Render/Express direto (sem redirects)
  app.get("/api/media", mediaHandler);

  // tRPC (monta nos dois caminhos)
  const trpcHandler = createExpressMiddleware({
    router: appRouter,
    createContext,
  });

  app.use("/api/trpc", cors(corsOptions), trpcHandler);
  app.use("/trpc", cors(corsOptions), trpcHandler);

  // OAuth (opcional)
  if (ENV.oAuthServerUrl) {
    app.use("/oauth", cors(corsOptions));
    registerOAuthRoutes(app);
  }

  return app;
}
