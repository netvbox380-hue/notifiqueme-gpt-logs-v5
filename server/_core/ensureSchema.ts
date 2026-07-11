import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export async function ensureSchema(db: PostgresJsDatabase<any>) {
  // Adiciona colunas sem quebrar dados
  await db.execute(sql`
    ALTER TABLE IF EXISTS users
      ADD COLUMN IF NOT EXISTS "createdByAdminId" integer;
  `);

  // Login com usuário + senha (hash). Não apaga dados.
  await db.execute(sql`
    ALTER TABLE IF EXISTS users
      ADD COLUMN IF NOT EXISTS "passwordHash" text;
  `);

  await db.execute(sql`
    ALTER TABLE IF EXISTS groups
      ADD COLUMN IF NOT EXISTS "createdByAdminId" integer;
  `);

  await db.execute(sql`
    ALTER TABLE IF EXISTS deliveries
      ADD COLUMN IF NOT EXISTS "feedback" text,
      ADD COLUMN IF NOT EXISTS "feedbackAt" timestamp;
  `);

  // Índices básicos (performance/isolamento)
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_users_tenant_createdBy ON users("tenantId","createdByAdminId");`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_groups_tenant_createdBy ON groups("tenantId","createdByAdminId");`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_deliveries_user ON deliveries("userId","notificationId");`
  );

  await db.execute(sql`
    ALTER TABLE IF EXISTS tenants
      ADD COLUMN IF NOT EXISTS "brandName" varchar(255),
      ADD COLUMN IF NOT EXISTS "brandLogoUrl" varchar(500),
      ADD COLUMN IF NOT EXISTS "brandPrimaryColor" varchar(32),
      ADD COLUMN IF NOT EXISTS "supportPhone" varchar(64),
      ADD COLUMN IF NOT EXISTS "pixKey" varchar(255),
      ADD COLUMN IF NOT EXISTS "mercadoPagoLink" varchar(500),
      ADD COLUMN IF NOT EXISTS "resellerId" integer;
  `);

  await db.execute(sql`
    ALTER TABLE IF EXISTS notifications
      ADD COLUMN IF NOT EXISTS "scheduleId" integer;
  `);



  // Garante novos valores do enum recurrence para bancos antigos
  await db.execute(sql`
    DO $$
    BEGIN
      ALTER TYPE recurrence ADD VALUE IF NOT EXISTS 'hourly';
      ALTER TYPE recurrence ADD VALUE IF NOT EXISTS 'yearly';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  await db.execute(sql`
    ALTER TABLE IF EXISTS schedules
      ADD COLUMN IF NOT EXISTS "lastExecutedAt" timestamp,
      ADD COLUMN IF NOT EXISTS "lastRunAt" timestamp,
      ADD COLUMN IF NOT EXISTS "lastRunStatus" varchar(24),
      ADD COLUMN IF NOT EXISTS "lastRunMessage" text,
      ADD COLUMN IF NOT EXISTS "lastNotificationId" integer,
      ADD COLUMN IF NOT EXISTS "lastTargetCount" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lastSuccessCount" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lastFailureCount" integer DEFAULT 0;
  `);

  // Garante valor do enum role para bancos antigos
  await db.execute(sql`
    DO $$
    BEGIN
      ALTER TYPE role ADD VALUE IF NOT EXISTS 'reseller';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  // Tabela de revendas para bancos antigos
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "resellers" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL,
      "slug" varchar(120) NOT NULL UNIQUE,
      "userId" integer NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
      "createdAt" timestamp DEFAULT NOW() NOT NULL,
      "updatedAt" timestamp DEFAULT NOW() NOT NULL
    );
  `);



  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "rate_limits" (
      "key" text PRIMARY KEY,
      "count" integer NOT NULL DEFAULT 0,
      "resetAt" timestamp NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT NOW()
    );
  `);

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_resetAt ON rate_limits("resetAt");`
  );

  // Índices auxiliares
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_tenants_resellerId ON tenants("resellerId");`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_resellers_userId ON resellers("userId");`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_resellers_slug ON resellers("slug");`
  );
}