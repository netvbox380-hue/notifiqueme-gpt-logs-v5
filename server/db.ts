import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { User, InsertUser } from "../drizzle/schema";
import { users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { ensureSchema } from "./_core/ensureSchema";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

// ✅ evita corrida (ensureSchema rodar várias vezes em paralelo)
let _dbInitPromise: Promise<void> | null = null;

// ✅ Logger detalhado do Drizzle (apenas em dev)
const drizzleLogger = {
  logQuery(query: string, params?: unknown[]) {
    console.log("🟦 [DRIZZLE] SQL:", query);
    if (params && params.length) {
      console.log("🟨 [DRIZZLE] PARAMS:", JSON.stringify(params));
    }
  },
};

export async function getDb() {
  if (_db) return _db;

  if (!ENV.databaseUrl) {
    console.warn("[Database] ⚠️ DATABASE_URL ausente (ENV.databaseUrl vazio).");
    return null;
  }

  // ✅ garante inicialização única
  if (!_dbInitPromise) {
    _dbInitPromise = (async () => {
      try {
        _client = postgres(ENV.databaseUrl, {
          ssl: { rejectUnauthorized: false },
          max: 10,
          idle_timeout: 20,
          connect_timeout: 10,
        });

        _db = drizzle(_client, {
          logger: ENV.isProduction ? undefined : drizzleLogger,
        });

        console.log("[Database] ✅ Conexão estabelecida com sucesso");

        // ✅ Garantir schema/tabelas/colunas necessárias (SEM apagar dados)
        try {
          await ensureSchema(_db);
          console.log("[Database] ✅ Schema verificado/ajustado com sucesso");
        } catch (schemaErr) {
          console.error(
            "[Database] ⚠️ Falha ao garantir schema (continuando):",
            schemaErr
          );
        }
      } catch (error) {
        console.error("[Database] ❌ Failed to connect:", error);
        _db = null;
        _client = null;
        _dbInitPromise = null;
      }
    })();
  }

  await _dbInitPromise;
  return _db;
}

// Função para verificar se é o owner do sistema
function isSystemOwner(openId: string): boolean {
  const ownerOpenId = ENV.ownerOpenId;
  if (!ownerOpenId) return false;
  return openId.toLowerCase() === ownerOpenId.toLowerCase();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const isOwner = isSystemOwner(user.openId);

    const values: Partial<InsertUser> = {
      openId: user.openId,
    };

    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      (values as any)[field] = normalized;
      (updateSet as any)[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }

    if (isOwner) {
      values.role = "owner";
      updateSet.role = "owner";
      values.tenantId = null;
      updateSet.tenantId = null;
      values.createdByAdminId = null;
      updateSet.createdByAdminId = null;

      console.log(
        `[Database] 👑 Usuário ${user.openId} identificado como OWNER do sistema`
      );
    } else if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (user.tenantId !== undefined && !isOwner) {
      values.tenantId = user.tenantId;
      updateSet.tenantId = user.tenantId;
    }

    if (user.createdByAdminId !== undefined && !isOwner) {
      values.createdByAdminId = user.createdByAdminId;
      updateSet.createdByAdminId = user.createdByAdminId;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (!updateSet.lastSignedIn) {
      updateSet.lastSignedIn = values.lastSignedIn;
    }

    // 🛡️ TRAVA FINAL: nunca permitir coluna "undefined"
    delete (updateSet as any)["undefined"];
    delete (values as any)["undefined"];

    await db
      .insert(users)
      .values(values as any)
      .onConflictDoUpdate({
        target: users.openId,
        set: updateSet as any,
      });

    console.log(
      `[Database] ✅ Usuário ${user.openId} upserted com role: ${
        (values as any).role || "user"
      }`
    );
  } catch (error) {
    console.error("[Database] ❌ Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;

  let retries = 3;
  while (retries > 0) {
    try {
      const result = await db
        .select()
        .from(users)
        .where(eq(users.openId, openId))
        .limit(1);

      return result.length > 0 ? (result[0] as User) : null;
    } catch (error) {
      retries--;
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        console.error("[Database] ❌ Failed to get user after retries:", error);
        return null;
      }
    }
  }

  return null;
}

// Função para atualizar role de um usuário
export async function updateUserRole(
  userId: number,
  role: "user" | "admin" | "reseller" | "owner",
  tenantId?: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Record<string, unknown> = { role };
  if (tenantId !== undefined) updateData.tenantId = tenantId;

  await db.update(users).set(updateData).where(eq(users.id, userId));
}

// Execução SQL arbitrária foi desabilitada por segurança.
export async function executeRawSQL(_sqlQuery: string) {
  throw new Error("executeRawSQL desabilitado por segurança");
}
