import { router, publicProcedure } from "@/server/trpc/init";
import { platformRouter } from "@/server/trpc/routers/platform";
import { orgRouter } from "@/server/trpc/routers/org";
import { financeRouter } from "@/server/trpc/routers/finance";
import { maintenanceRouter } from "@/server/trpc/routers/maintenance";
import { notificationsRouter } from "@/server/trpc/routers/notifications";
import { reportsRouter } from "@/server/trpc/routers/reports";
import { securityRouter } from "@/server/trpc/routers/security";
import { governanceRouter } from "@/server/trpc/routers/governance";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date() })),
  platform: platformRouter,
  org: orgRouter,
  finance: financeRouter,
  maintenance: maintenanceRouter,
  notifications: notificationsRouter,
  reports: reportsRouter,
  security: securityRouter,
  governance: governanceRouter,
});

export type AppRouter = typeof appRouter;
