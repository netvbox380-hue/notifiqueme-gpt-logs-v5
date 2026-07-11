import {
  integer,
  serial,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums (tipos Postgres)
const statusEnum = pgEnum("status", ["active", "suspended", "expired"]);
const planEnum = pgEnum("plan", ["basic", "pro", "enterprise"]);
const roleEnum = pgEnum("role", ["user", "admin", "reseller", "owner"]);
const priorityEnum = pgEnum("priority", ["normal", "important", "urgent"]);
const targetTypeEnum = pgEnum("targetType", ["all", "users", "groups"]);
const recurrenceEnum = pgEnum("recurrence", ["none", "hourly", "daily", "weekly", "monthly", "yearly"]);

// ✅ ATUALIZADO: adiciona "read" (visualizado)
const deliveryStatusEnum = pgEnum("deliveryStatus", [
  "sent",
  "delivered",
  "read",
  "failed",
]);

// ✅ Feedback (expandido)
const feedbackEnum = pgEnum("deliveryFeedback", [
  "liked",
  "disliked",
  "renew",
  "no_renew",
  "problem",
]);

/**
 * Tabela de Tenants (Clientes/Empresas)
 */
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  ownerId: integer("ownerId"),
  resellerId: integer("resellerId"),

  status: statusEnum("status").notNull().default("active"),
  plan: planEnum("plan").notNull().default("basic"),

  subscriptionExpiresAt: timestamp("subscriptionExpiresAt"),
  brandName: varchar("brandName", { length: 255 }),
  brandLogoUrl: varchar("brandLogoUrl", { length: 500 }),
  brandPrimaryColor: varchar("brandPrimaryColor", { length: 32 }),
  supportPhone: varchar("supportPhone", { length: 64 }),
  pixKey: varchar("pixKey", { length: 255 }),
  mercadoPagoLink: varchar("mercadoPagoLink", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

/**
 * Daily credit usage per tenant (credits = deliveries)
 * - One row per tenant per day (UTC date string)
 */
export const tenantDailyUsage = pgTable(
  "tenant_daily_usage",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD (UTC)
    creditsUsed: integer("creditsUsed").notNull().default(0),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    uniqTenantDay: uniqueIndex("uniq_tenant_daily_usage_tenant_day").on(t.tenantId, t.day),
    idxTenantDay: index("idx_tenant_daily_usage_day").on(t.day),
  })
);

export type TenantDailyUsage = typeof tenantDailyUsage.$inferSelect;
export type InsertTenantDailyUsage = typeof tenantDailyUsage.$inferInsert;



export const resellers = pgTable("resellers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  userId: integer("userId").notNull().unique(),
  status: statusEnum("status").notNull().default("active"),
  brandName: varchar("brandName", { length: 255 }),
  brandLogoUrl: varchar("brandLogoUrl", { length: 500 }),
  brandPrimaryColor: varchar("brandPrimaryColor", { length: 32 }),
  supportPhone: varchar("supportPhone", { length: 64 }),
  pixKey: varchar("pixKey", { length: 255 }),
  mercadoPagoLink: varchar("mercadoPagoLink", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Reseller = typeof resellers.$inferSelect;
export type InsertReseller = typeof resellers.$inferInsert;


/**
 * Users
 * - Owner: role=owner, tenantId=null
 * - Admin: role=admin, tenantId=..., createdByAdminId=null
 * - User comum: role=user, tenantId=..., createdByAdminId=<admin.id>
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId"),
    createdByAdminId: integer("createdByAdminId"),

    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),

    passwordHash: text("passwordHash"),

    role: roleEnum("role").notNull().default("user"),

    // ✅ Card informativo persistente e personalizado por usuário final
    // (ex: "Troque o óleo em 12/07/2027"), editado pelo admin na tela de
    // Usuários e exibido só pra esse usuário específico.
    announcementEnabled: boolean("announcementEnabled").notNull().default(false),
    announcementBody: text("announcementBody"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  (t) => ({
    idxUsersTenantCreatedBy: index("idx_users_tenant_createdby").on(
      t.tenantId,
      t.createdByAdminId
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Grupos (isolados por Tenant e por Admin criador)
 */
export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    createdByAdminId: integer("createdByAdminId").notNull(),

    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    idxGroupsTenantCreatedBy: index("idx_groups_tenant_createdby").on(
      t.tenantId,
      t.createdByAdminId
    ),
  })
);

export type Group = typeof groups.$inferSelect;
export type InsertGroup = typeof groups.$inferInsert;

/**
 * Relação user <-> group
 */
export const userGroups = pgTable(
  "user_groups",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    groupId: integer("groupId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    uqUserGroup: uniqueIndex("uq_user_groups_user_group").on(t.userId, t.groupId),
    idxUserGroupsGroup: index("idx_user_groups_group").on(t.groupId),
    idxUserGroupsUser: index("idx_user_groups_user").on(t.userId),
  })
);

/**
 * Notificações/Mensagens (isoladas por tenant e criadas por admin/owner)
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),

    priority: priorityEnum("priority").notNull().default("normal"),

    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),

    targetType: targetTypeEnum("targetType").notNull().default("all"),
    targetIds: json("targetIds").$type<number[]>().default([]),

    imageUrl: varchar("imageUrl", { length: 500 }),

    isScheduled: boolean("isScheduled").notNull().default(false),
    scheduledFor: timestamp("scheduledFor"),

    recurrence: recurrenceEnum("recurrence").notNull().default("none"),

    scheduleId: integer("scheduleId"),

    isActive: boolean("isActive").notNull().default(true),
  },
  (t) => ({
    idxNotificationsTenantCreatedAt: index("idx_notifications_tenant_createdat").on(
      t.tenantId,
      t.createdAt
    ),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Agendamentos (recorrência real usa nextRunAt)
 */
export const schedules = pgTable(
  "schedules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content").notNull(),

    priority: priorityEnum("priority").notNull().default("normal"),

    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),

    targetType: targetTypeEnum("targetType").notNull().default("all"),
    targetIds: json("targetIds").$type<number[]>().default([]),
    imageUrl: varchar("imageUrl", { length: 500 }),

    scheduledFor: timestamp("scheduledFor").notNull(),
    recurrence: recurrenceEnum("recurrence").notNull().default("none"),

    isActive: boolean("isActive").notNull().default(true),
    lastExecutedAt: timestamp("lastExecutedAt"),
    lastRunAt: timestamp("lastRunAt"),
    lastRunStatus: varchar("lastRunStatus", { length: 24 }),
    lastRunMessage: text("lastRunMessage"),
    lastNotificationId: integer("lastNotificationId"),
    lastTargetCount: integer("lastTargetCount").default(0),
    lastSuccessCount: integer("lastSuccessCount").default(0),
    lastFailureCount: integer("lastFailureCount").default(0),

    nextRunAt: timestamp("nextRunAt"),
  },
  (t) => ({
    idxSchedulesDue: index("idx_schedules_due").on(t.isActive, t.nextRunAt),
    idxSchedulesTenant: index("idx_schedules_tenant").on(t.tenantId),
  })
);

export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;

/**
 * Entregas (inbox do usuário)
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    notificationId: integer("notificationId").notNull(),
    userId: integer("userId").notNull(),

    status: deliveryStatusEnum("status").notNull().default("sent"),

    deliveredAt: timestamp("deliveredAt"),
    readAt: timestamp("readAt"),

    isRead: boolean("isRead").notNull().default(false),

    errorMessage: text("errorMessage"),

    feedback: feedbackEnum("feedback"),
    feedbackAt: timestamp("feedbackAt"),
  },
  (t) => ({
    idxDeliveriesUser: index("idx_deliveries_user").on(t.userId, t.isRead, t.id),
    idxDeliveriesTenant: index("idx_deliveries_tenant").on(t.tenantId),
    uniqDelivery: uniqueIndex("uniq_deliveries_tenant_notification_user").on(t.tenantId, t.notificationId, t.userId),
  })
);

export type Delivery = typeof deliveries.$inferSelect;
export type InsertDelivery = typeof deliveries.$inferInsert;

/**
 * Push Subscriptions (Web Push)
 * Um usuário pode ter múltiplos devices/browsers.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    idxPushSubsUser: index("idx_push_subscriptions_user").on(t.userId),
  })
);

/* =========================
   Job queue (DB-based)
   - Used to process scheduled dispatch at scale
   - Also enables idempotency via dedupeKey
========================= */
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "done",
  "failed",
]);

export const jobQueue = pgTable(
  "job_queue",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 80 }).notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    dedupeKey: varchar("dedupe_key", { length: 200 }),

    // JSON payload (stored as text for portability)
    payload: text("payload").notNull(),

    runAt: timestamp("run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeKeyUq: uniqueIndex("job_queue_dedupe_key_uq").on(t.dedupeKey),
    statusRunAtIdx: index("job_queue_status_run_at_idx").on(t.status, t.runAt),
  })
);

export const files = pgTable(
  "files",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    fileKey: varchar("fileKey", { length: 500 }).notNull(),
    url: varchar("url", { length: 500 }).notNull(),
    mimeType: varchar("mimeType", { length: 100 }),
    fileSize: integer("fileSize"),
    uploadedBy: integer("uploadedBy").notNull(),
    uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
    relatedNotificationId: integer("relatedNotificationId"),
    isPublic: boolean("isPublic").notNull().default(false),
  },
  (t) => ({
    idxFilesTenant: index("idx_files_tenant").on(t.tenantId),
  })
);

export type File = typeof files.$inferSelect;
export type InsertFile = typeof files.$inferInsert;

/**
 * Logs (isolados por tenant e opcionalmente por admin)
 */
export const logs = pgTable(
  "logs",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId"),
    createdByAdminId: integer("createdByAdminId"),
    userId: integer("userId"),
    action: varchar("action", { length: 255 }).notNull(),
    entityType: varchar("entityType", { length: 100 }),
    entityId: integer("entityId"),
    details: text("details"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    idxLogsTenant: index("idx_logs_tenant").on(t.tenantId, t.createdAt),
  })
);
