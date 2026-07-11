import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { files, deliveries } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { storageCreatePutUrl, storageGet, storagePut } from "../storage";
import { getTenantPlanLimits } from "../_core/credits";
import { assertRateLimit } from "../_core/rateLimit";
import { assertTenantInScopeOrThrow } from "../_core/ownership";


const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);

function requireTenantId(ctx: any): number {
  const tid = ctx.user?.tenantId;
  if (!tid) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
  return tid;
}

function sanitizeFilename(name: string) {
  const base = name.split("/").pop()?.split("\\").pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "file";
}

function extFromMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "bin";
}

function decodeBase64Data(input: string): Buffer {
  const base64 = input.includes("base64,")
    ? input.split("base64,")[1]
    : input.includes(",")
      ? input.split(",")[1]
      : input;
  return Buffer.from(base64, "base64");
}

export const uploadRouter = router({
  /**
   * ✅ Upload direto via S3 Presigned URL
   * - Evita limites do Netlify CLI / Netlify Functions / body-parser
   * - Mantém compatibilidade: o método `upload` (base64) continua existindo.
   */
  createPutUrl: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        fileSize: z.number().int().positive(),
        relatedNotificationId: z.number().optional(),
        tenantId: z.number().optional(),
        isPublic: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas admin/owner podem enviar arquivos",
        });
      }

      if (!allowedTypes.has(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tipo de arquivo não permitido.",
        });
      }

      

      const tenantId =
        ctx.user.role === "owner" ? input.tenantId : requireTenantId(ctx);

      if (!tenantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "tenantId obrigatório",
        });
      }

      const dbScope = await getDb();
      if (!dbScope) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
      await assertTenantInScopeOrThrow(dbScope, ctx.user, tenantId);

      const { limits } = await getTenantPlanLimits(tenantId);

      // ✅ rate limit upload
      await assertRateLimit({ req: ctx.req, key: "upload.createPutUrl", limit: 120, windowMs: 60_000 });

      const maxSize = limits.maxFileSizeBytes;
      if (input.fileSize > maxSize) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Arquivo muito grande (máx ${Math.ceil(maxSize / (1024 * 1024))}MB)`,
        });
      }

      const safeName = sanitizeFilename(input.filename);
      const providedExt = safeName.includes(".") ? safeName.split(".").pop() : null;
      const ext = (
        providedExt && providedExt.length <= 8 ? providedExt : extFromMime(input.mimeType)
      ).toLowerCase();

      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);
      const fileKey = `uploads/${tenantId}/${ctx.user.id}/${ts}-${rand}.${ext}`;

      let putUrl: string;
      try {
        ({ putUrl } = await storageCreatePutUrl(fileKey, input.mimeType));
      } catch (e) {
        // Se estiver em modo local (sem S3), este fluxo não é suportado.
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message:
            "Upload direto requer S3 configurado. Configure MY_AWS_* ou use upload padrão.",
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco indisponível",
        });
      }

      const inserted = await db
        .insert(files)
        .values({
          tenantId,
          filename: safeName,
          fileKey,
          // URL pode ficar vazio; `getFileUrl` gera signed URL sob demanda.
          url: "",
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          uploadedBy: ctx.user.id,
          uploadedAt: new Date(),
          relatedNotificationId: input.relatedNotificationId ?? null,
          isPublic: input.isPublic,
        } as any)
        .returning({ id: files.id, fileKey: files.fileKey });

      return {
        success: true,
        fileId: inserted[0]?.id || 0,
        fileKey: inserted[0]?.fileKey || fileKey,
        putUrl,
      };
    }),

  upload: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1, "Nome do arquivo é obrigatório"),
        fileData: z.string().min(1, "fileData é obrigatório"),
        mimeType: z.string().min(1, "Tipo MIME é obrigatório"),
        relatedNotificationId: z.number().optional(),
        tenantId: z.number().optional(),
        isPublic: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas admin/owner podem enviar arquivos",
        });
      }

      if (!allowedTypes.has(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tipo de arquivo não permitido.",
        });
      }

      const buffer = decodeBase64Data(input.fileData);

      

      const tenantId =
        ctx.user.role === "owner" ? input.tenantId : requireTenantId(ctx);

      if (!tenantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "tenantId obrigatório",
        });
      }

      const dbScope = await getDb();
      if (!dbScope) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível" });
      await assertTenantInScopeOrThrow(dbScope, ctx.user, tenantId);

      const { limits } = await getTenantPlanLimits(tenantId);

      // ✅ rate limit upload
      await assertRateLimit({ req: ctx.req, key: "upload.upload", limit: 120, windowMs: 60_000 });

      const maxSize = limits.maxFileSizeBytes;
      if (buffer.length > maxSize) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Arquivo muito grande (máx ${Math.ceil(maxSize / (1024 * 1024))}MB)`,
        });
      }

      const safeName = sanitizeFilename(input.filename);
      const providedExt = safeName.includes(".") ? safeName.split(".").pop() : null;
      const ext = (
        providedExt && providedExt.length <= 8 ? providedExt : extFromMime(input.mimeType)
      ).toLowerCase();

      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 10);
      const fileKey = `uploads/${tenantId}/${ctx.user.id}/${ts}-${rand}.${ext}`;

      const putResult = await storagePut(fileKey, buffer, input.mimeType);

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco indisponível",
        });
      }

      const inserted = await db
        .insert(files)
        .values({
          tenantId,
          filename: safeName,
          fileKey: putResult.key,
          url: putResult.url || "",
          mimeType: input.mimeType,
          fileSize: buffer.length,
          uploadedBy: ctx.user.id,
          uploadedAt: new Date(),
          relatedNotificationId: input.relatedNotificationId ?? null,
          isPublic: input.isPublic,
        } as any)
        .returning({ id: files.id, fileKey: files.fileKey, url: files.url });

      return {
        success: true,
        fileId: inserted[0]?.id || 0,
        fileKey: inserted[0]?.fileKey || putResult.key,
        url: inserted[0]?.url || putResult.url,
      };
    }),

  getFileUrl: protectedProcedure
    .input(
      z.object({
        fileId: z.number().optional(),
        fileKey: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (!input.fileId && !input.fileKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Informe fileId ou fileKey",
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Banco indisponível",
        });
      }

      let row: any;

      if (input.fileId) {
        row = (
          await db.select().from(files).where(eq(files.id, input.fileId)).limit(1)
        )?.[0];
      } else {
        row = (
          await db.select().from(files).where(eq(files.fileKey, input.fileKey!)).limit(1)
        )?.[0];
      }

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo não encontrado",
        });
      }

      // 🔒 USER pode ver apenas anexos das notificações que recebeu
      if (ctx.user.role === "user") {
        const tid = requireTenantId(ctx);
        if (Number(row.tenantId) !== Number(tid)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso" });
        }

        if (!row.relatedNotificationId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sem acesso (arquivo sem notificação vinculada)",
          });
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
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sem acesso",
          });
        }
      }

      // 🔒 ADMIN só do tenant
      if (ctx.user.role === "admin") {
        const tid = requireTenantId(ctx);
        if (Number(row.tenantId) !== Number(tid)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sem acesso",
          });
        }
      }

      // 🔒 REVENDA só dos tenants da própria revenda
      if (ctx.user.role === "reseller") {
        await assertTenantInScopeOrThrow(db, ctx.user, Number(row.tenantId));
      }

      // ✅ Sempre gerar URL atual do storage para evitar signed URL expirada salva no banco.
      // Mesmo que `row.url` exista, ela pode ser temporária e já ter vencido.
      const got = await storageGet(row.fileKey);

      return { success: true, fileId: row.id, fileKey: row.fileKey, url: got.url };
    }),
});
