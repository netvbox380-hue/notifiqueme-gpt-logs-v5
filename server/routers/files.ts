import { z } from "zod";
import { adminOnlyProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { deliveries, files } from "../../drizzle/schema";
import { storageDelete, storageGet } from "../storage";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { assertTenantInScopeOrThrow } from "../_core/ownership";

function requireDbOrThrow(db: any) {
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Banco de dados não disponível",
    });
  }
}

function requireTenantId(ctx: any): number {
  const tid = ctx.user?.tenantId;
  if (!tid) throw new TRPCError({ code: "FORBIDDEN", message: "Sem tenant" });
  return tid;
}

async function assertUserCanAccessFileOrThrow(db: any, ctx: any, file: any) {
  const tid = requireTenantId(ctx);
  if (Number(file.tenantId) !== Number(tid)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para acessar este arquivo" });
  }

  if (Number(file.uploadedBy) === Number(ctx.user.id)) return;

  if (!file.relatedNotificationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para acessar este arquivo" });
  }

  const hasAccess = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.notificationId, file.relatedNotificationId),
        eq(deliveries.userId, ctx.user.id)
      )
    )
    .limit(1);

  if (!hasAccess.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para acessar este arquivo" });
  }
}

export const filesRouter = router({
  /**
   * ✅ IMPORTANTE:
   * Upload de arquivo NÃO deve ser feito por tRPC com Buffer.
   * Use o uploadRouter (REST/multipart) e grave apenas o metadata aqui.
   */
  createMetadata: adminOnlyProcedure
    .input(
      z.object({
        tenantId: z.number().optional(), // owner pode escolher
        filename: z.string().min(1),
        fileKey: z.string().min(1),
        url: z.string().min(1),
        mimeType: z.string().optional(),
        fileSize: z.number().int().nonnegative().optional(),
        relatedNotificationId: z.number().optional(),
        isPublic: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const role = ctx.user.role;

      // tenant alvo:
      // - owner: pode escolher tenantId (obrigatório para salvar com consistência)
      // - admin/user: sempre o tenantId do usuário
      const tenantId =
        role === "owner" ? input.tenantId : requireTenantId(ctx);

      if (!tenantId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "tenantId é obrigatório (owner deve informar)",
        });
      }

      await assertTenantInScopeOrThrow(db, ctx.user, tenantId);

      const inserted = await db
        .insert(files)
        .values({
          tenantId,
          filename: input.filename,
          fileKey: input.fileKey,
          url: input.url,
          mimeType: input.mimeType ?? null,
          fileSize: input.fileSize ?? null,
          uploadedBy: ctx.user.id,
          uploadedAt: new Date(),
          relatedNotificationId: input.relatedNotificationId ?? null,
          isPublic: input.isPublic,
        } as any)
        .returning({ id: files.id });

      return {
        success: true,
        id: inserted[0]?.id || 0,
      };
    }),

  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(20),
        offset: z.number().min(0).default(0),
        tenantId: z.number().optional().nullable(), // owner pode filtrar
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const role = ctx.user.role;

      // regras:
      // - owner: pode ver tudo, opcionalmente filtrar por tenantId
      // - admin: só do próprio tenant
      // - user: só o que ele enviou + do tenant dele
      let whereClause: any = undefined;

      if (role === "owner") {
        if (input.tenantId) {
          whereClause = eq(files.tenantId, input.tenantId);
        }
      } else if (role === "reseller") {
        if (input.tenantId) {
          await assertTenantInScopeOrThrow(db, ctx.user, input.tenantId);
          whereClause = eq(files.tenantId, input.tenantId);
        }
      } else if (role === "admin") {
        const tid = requireTenantId(ctx);
        whereClause = eq(files.tenantId, tid);
      } else {
        const tid = requireTenantId(ctx);
        whereClause = and(eq(files.tenantId, tid), eq(files.uploadedBy, ctx.user.id));
      }

      let data: any[];
      let total = 0;

      if (role === "reseller" && !input.tenantId) {
        const all = await db
          .select()
          .from(files)
          .orderBy(sql`${files.id} DESC`);
        const kept: any[] = [];
        for (const row of all) {
          try {
            await assertTenantInScopeOrThrow(db, ctx.user, Number((row as any).tenantId));
            kept.push(row as any);
          } catch {}
        }
        total = kept.length;
        data = kept.slice(input.offset, input.offset + input.limit);
      } else {
        data = await db
          .select()
          .from(files)
          .where(whereClause)
          .orderBy(sql`${files.id} DESC`)
          .limit(input.limit)
          .offset(input.offset);

        const totalRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(files)
          .where(whereClause);
        total = Number(totalRows?.[0]?.count ?? 0);
      }

      return {
        success: true,
        data,
        total,
      };
    }),

  
  listByNotificationId: protectedProcedure
    .input(
      z.object({
        notificationId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const role = ctx.user.role;

      if (role === "user") {
        const canSeeNotification = await db
          .select({ id: deliveries.id })
          .from(deliveries)
          .where(
            and(
              eq(deliveries.notificationId, input.notificationId),
              eq(deliveries.userId, ctx.user.id)
            )
          )
          .limit(1);

        if (!canSeeNotification.length) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
        }
      }

      const whereClause =
        role === "owner"
          ? eq(files.relatedNotificationId, input.notificationId)
          : role === "reseller"
          ? undefined
          : and(
              eq(files.tenantId, requireTenantId(ctx)),
              eq(files.relatedNotificationId, input.notificationId)
            );

      let resellerRows: any[] | null = null;
      if (role === "reseller") {
        const allRows = await db
          .select()
          .from(files)
          .where(eq(files.relatedNotificationId, input.notificationId))
          .orderBy(sql`${files.id} ASC`);
        const kept: any[] = [];
        for (const row of allRows) {
          await assertTenantInScopeOrThrow(db, ctx.user, Number((row as any).tenantId));
          kept.push(row as any);
        }
        resellerRows = kept;
      }

      const rowsRaw = resellerRows ?? await db
  .select()
  .from(files)
  .where(whereClause)
  .orderBy(sql`${files.id} ASC`);

// ✅ Compat + correção: se a URL estiver vazia, devolve o fileKey (uploads/...)
// Assim o front consegue resolver (imagem: signed via getFileUrl | vídeo: proxy /api/media).
const rows = rowsRaw.map((r) => {
  const key = (r as any)?.fileKey as string | undefined;
  const url = (r as any)?.url as string | undefined;

  if ((!url || url.trim() === "") && key && key.startsWith("uploads/")) {
    return { ...(r as any), url: key };
  }
  return r as any;
});

return { success: true, data: rows };

    }),

getDownloadUrl: protectedProcedure
    .input(z.number())
    .query(async ({ ctx, input: fileId }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado" });
      }

      const file = rows[0];

      // autorização:
      // - owner: ok
      // - admin: só do tenant dele
      // - user: se uploadedBy dele OU isPublic
      if (ctx.user.role === "owner") {
        // ok
      } else if (ctx.user.role === "reseller") {
        await assertTenantInScopeOrThrow(db, ctx.user, Number(file.tenantId));
      } else if (ctx.user.role === "admin") {
        const tid = requireTenantId(ctx);
        if (file.tenantId !== tid) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
        }
      } else {
        await assertUserCanAccessFileOrThrow(db, ctx, file);
      }

      const { url } = await storageGet(file.fileKey);

      return { success: true, url, filename: file.filename };
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ ctx, input: fileId }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado" });
      }

      const file = rows[0];

      // autorização:
      // - owner: ok
      // - admin: só do tenant dele
      // - user: só se uploadedBy dele
      if (ctx.user.role === "owner") {
        // ok
      } else if (ctx.user.role === "reseller") {
        await assertTenantInScopeOrThrow(db, ctx.user, Number(file.tenantId));
      } else if (ctx.user.role === "admin") {
        const tid = requireTenantId(ctx);
        if (file.tenantId !== tid) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
      } else {
        const tid = requireTenantId(ctx);
        if (file.tenantId !== tid || file.uploadedBy !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Você não tem permissão para deletar este arquivo" });
        }
      }

      await storageDelete(file.fileKey);
      await db.delete(files).where(eq(files.id, fileId));

      return { success: true, message: "Arquivo deletado com sucesso" };
    }),

  getById: protectedProcedure
    .input(z.number())
    .query(async ({ ctx, input: fileId }) => {
      const db = await getDb();
      requireDbOrThrow(db);

      const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Arquivo não encontrado" });
      }

      const file = rows[0];

      if (ctx.user.role === "owner") {
        return { success: true, data: file };
      }

      if (ctx.user.role === "reseller") {
        await assertTenantInScopeOrThrow(db, ctx.user, Number(file.tenantId));
        return { success: true, data: file };
      }

      if (ctx.user.role === "admin") {
        const tid = requireTenantId(ctx);
        if (file.tenantId !== tid) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
        return { success: true, data: file };
      }

      await assertUserCanAccessFileOrThrow(db, ctx, file);

      return { success: true, data: file };
    }),
});
