import { router } from "./_core/trpc";

import { systemRouter } from "./_core/systemRouter";
import { authRouter } from "./routers/auth";
import { notificationsRouter } from "./routers/notifications";
import { groupsRouter } from "./routers/groups";
import { filesRouter } from "./routers/files";
import { uploadRouter } from "./routers/upload";
import { tenantRouter } from "./routers/tenant";
import { superAdminRouter } from "./routers/superadmin";
import { resellerRouter } from "./routers/reseller";
import { pushRouter } from "./routers/push";
import { healthRouter } from "./routers/health";

// ✅ NOVO
import { schedulesRouter } from "./routers/schedules";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,

  notifications: notificationsRouter,

  tenant: tenantRouter,
  groups: groupsRouter,
  files: filesRouter,
  upload: uploadRouter,

  // ✅ recorrência e agendamentos
  schedules: schedulesRouter,

  superadmin: superAdminRouter,
  reseller: resellerRouter,
  push: pushRouter,
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
