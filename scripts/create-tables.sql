ALTER TYPE role ADD VALUE IF NOT EXISTS 'reseller';
-- Script de criação das tabelas para o Notifique-Me
-- PostgreSQL - Render

-- ============================
-- Criar tipos ENUM
-- ============================
DO $$ BEGIN
    CREATE TYPE status AS ENUM ('active', 'suspended', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE plan AS ENUM ('basic', 'pro', 'enterprise');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE role AS ENUM ('user', 'admin', 'owner');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE priority AS ENUM ('normal', 'important', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "targetType" AS ENUM ('all', 'users', 'groups');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE recurrence AS ENUM ('none', 'hourly', 'daily', 'weekly', 'monthly', 'yearly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "deliveryStatus" AS ENUM ('sent', 'delivered', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ✅ faltava no SQL (existe no Drizzle)
DO $$ BEGIN
    CREATE TYPE "deliveryFeedback" AS ENUM ('liked', 'renew', 'disliked');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================
-- Tabela de Tenants
-- ============================
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    "ownerId" INTEGER,
    status status NOT NULL DEFAULT 'active',
    plan plan NOT NULL DEFAULT 'basic',
    "subscriptionExpiresAt" TIMESTAMP,
    "brandName" VARCHAR(255),
    "brandLogoUrl" VARCHAR(500),
    "brandPrimaryColor" VARCHAR(32),
    "supportPhone" VARCHAR(64),
    "pixKey" VARCHAR(255),
    "mercadoPagoLink" VARCHAR(500),
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);



ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "brandName" VARCHAR(255);
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "brandLogoUrl" VARCHAR(500);
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "brandPrimaryColor" VARCHAR(32);
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "supportPhone" VARCHAR(64);
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "pixKey" VARCHAR(255);
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS "mercadoPagoLink" VARCHAR(500);

-- ============================
-- Créditos diários por tenant (1 delivery = 1 crédito)
-- ============================
CREATE TABLE IF NOT EXISTS tenant_daily_usage (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day VARCHAR(10) NOT NULL, -- YYYY-MM-DD (UTC)
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uniq_tenant_daily_usage_tenant_day UNIQUE ("tenantId", day)
);

CREATE INDEX IF NOT EXISTS idx_tenant_daily_usage_day ON tenant_daily_usage(day);

-- ============================
-- Tabela de Usuários
-- ============================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    "createdByAdminId" INTEGER,
    "openId" VARCHAR(64) NOT NULL UNIQUE,
    name TEXT,
    email VARCHAR(320),
    "loginMethod" VARCHAR(64),
    "passwordHash" TEXT,
    role role NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "lastSignedIn" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Garantir colunas novas em bases existentes (sem apagar dados)
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS "createdByAdminId" INTEGER;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- ============================
-- Tabela de Grupos
-- ============================
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    "createdByAdminId" INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ✅ garantir coluna em bases existentes
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS "createdByAdminId" INTEGER;

-- ============================
-- Tabela user_groups
-- ============================
CREATE TABLE IF NOT EXISTS user_groups (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "groupId" INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE("userId", "groupId")
);

-- ============================
-- Tabela de Notificações
-- ============================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority priority NOT NULL DEFAULT 'normal',
    "createdBy" INTEGER NOT NULL REFERENCES users(id),
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "targetType" "targetType" NOT NULL DEFAULT 'all',
    "targetIds" JSONB,
    "imageUrl" VARCHAR(500),
    "isScheduled" BOOLEAN DEFAULT FALSE,
    "scheduledFor" TIMESTAMP,
    recurrence recurrence DEFAULT 'none',
    "scheduleId" INTEGER,
    "isActive" BOOLEAN DEFAULT TRUE
);

ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS "scheduleId" INTEGER;

-- ============================
-- Tabela de Agendamentos
-- ============================
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority priority NOT NULL DEFAULT 'normal',
    "createdBy" INTEGER NOT NULL REFERENCES users(id),
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "targetType" "targetType" NOT NULL DEFAULT 'all',
    "targetIds" JSONB,
    "imageUrl" VARCHAR(500),
    "scheduledFor" TIMESTAMP NOT NULL,
    recurrence recurrence DEFAULT 'none',
    "isActive" BOOLEAN DEFAULT TRUE,
    "lastExecutedAt" TIMESTAMP,
    "lastRunAt" TIMESTAMP,
    "lastRunStatus" VARCHAR(24),
    "lastRunMessage" TEXT,
    "lastNotificationId" INTEGER,
    "lastTargetCount" INTEGER DEFAULT 0,
    "lastSuccessCount" INTEGER DEFAULT 0,
    "lastFailureCount" INTEGER DEFAULT 0,
    -- ✅ motor de recorrência usa isso como “próxima execução”
    "nextRunAt" TIMESTAMP
);

-- ✅ garantir coluna/índice em bases existentes (sem apagar dados)
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMP;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastRunStatus" VARCHAR(24);
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastRunMessage" TEXT;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastNotificationId" INTEGER;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastTargetCount" INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastSuccessCount" INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS schedules ADD COLUMN IF NOT EXISTS "lastFailureCount" INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_schedules_due
ON schedules ("isActive", "nextRunAt");

-- ============================
-- Tabela de Entregas (Inbox)
-- ============================
CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    "notificationId" INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status "deliveryStatus" NOT NULL DEFAULT 'sent',
    "deliveredAt" TIMESTAMP,
    "readAt" TIMESTAMP,
    "isRead" BOOLEAN DEFAULT FALSE,
    "errorMessage" TEXT,
    -- ✅ faltava no SQL (existe no Drizzle)
    feedback "deliveryFeedback",
    "feedbackAt" TIMESTAMP
);

-- ✅ garantir colunas em bases existentes
ALTER TABLE IF EXISTS deliveries ADD COLUMN IF NOT EXISTS feedback "deliveryFeedback";
ALTER TABLE IF EXISTS deliveries ADD COLUMN IF NOT EXISTS "feedbackAt" TIMESTAMP;

-- ============================
-- Tabela de Arquivos
-- ============================
CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    "fileKey" VARCHAR(500) NOT NULL,
    url VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(100),
    "fileSize" INTEGER,
    "uploadedBy" INTEGER NOT NULL REFERENCES users(id),
    "uploadedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "relatedNotificationId" INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
    "isPublic" BOOLEAN
);

-- ============================
-- Tabela de Logs
-- ============================
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    "tenantId" INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
    "createdByAdminId" INTEGER,
    "userId" INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    "entityType" VARCHAR(100),
    "entityId" INTEGER,
    details TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ✅ garantir coluna em bases existentes
ALTER TABLE IF EXISTS logs ADD COLUMN IF NOT EXISTS "createdByAdminId" INTEGER;

-- ============================
-- Índices para performance
-- ============================
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users("tenantId");
CREATE INDEX IF NOT EXISTS idx_users_openid ON users("openId");
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_groups_tenant ON groups("tenantId");

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications("tenantId");
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications("createdAt");

CREATE INDEX IF NOT EXISTS idx_deliveries_notification ON deliveries("notificationId");
CREATE INDEX IF NOT EXISTS idx_deliveries_user ON deliveries("userId");

CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules("tenantId");
CREATE INDEX IF NOT EXISTS idx_schedules_scheduled ON schedules("scheduledFor");

CREATE INDEX IF NOT EXISTS idx_logs_tenant ON logs("tenantId");
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs("createdAt");

-- ============================
-- Comentários
-- ============================
COMMENT ON TABLE tenants IS 'Clientes/Empresas que compram licença do sistema';
COMMENT ON TABLE users IS 'Usuários do sistema (owner, admin, user)';
COMMENT ON TABLE groups IS 'Grupos de usuários para segmentação de notificações';
COMMENT ON TABLE notifications IS 'Notificações enviadas para usuários';
COMMENT ON TABLE schedules IS 'Agendamentos de notificações futuras';
COMMENT ON TABLE deliveries IS 'Log de entrega e leitura de notificações';
COMMENT ON TABLE files IS 'Arquivos enviados (imagens, vídeos)';
COMMENT ON TABLE logs IS 'Logs de ações do sistema para auditoria';


-- ============================
-- Push Subscriptions (Web Push)
-- ============================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================
-- Job Queue (DB-based)
-- =========================
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('queued', 'processing', 'done', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS job_queue (
  id SERIAL PRIMARY KEY,
  type VARCHAR(80) NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  dedupe_key VARCHAR(200) UNIQUE,
  payload TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_queue_status_run_at_idx
  ON job_queue (status, run_at);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions("userId");

-- Idempotência: evitar deliveries duplicados
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deliveries_tenant_notification_user ON deliveries("tenantId","notificationId","userId");


CREATE TABLE IF NOT EXISTS resellers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  "userId" INTEGER NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  "brandName" VARCHAR(255),
  "brandLogoUrl" VARCHAR(500),
  "brandPrimaryColor" VARCHAR(32),
  "supportPhone" VARCHAR(64),
  "pixKey" VARCHAR(255),
  "mercadoPagoLink" VARCHAR(500),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS "resellerId" INTEGER;
