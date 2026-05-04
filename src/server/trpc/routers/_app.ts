import { router, publicProcedure } from "@/server/trpc/init";
import { platformRouter } from "@/server/trpc/routers/platform";
import { orgRouter } from "@/server/trpc/routers/org";
import { financeRouter } from "@/server/trpc/routers/finance";
import { maintenanceRouter } from "@/server/trpc/routers/maintenance";
import { notificationsRouter } from "@/server/trpc/routers/notifications";
import { reportsRouter } from "@/server/trpc/routers/reports";
import { securityRouter } from "@/server/trpc/routers/security";
import { governanceRouter } from "@/server/trpc/routers/governance";
import { portalRouter } from "@/server/trpc/routers/portal";
import { comercialRouter } from "@/server/trpc/routers/comercial";
import { reservationsRouter } from "@/server/trpc/routers/reservations";

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
  portal: portalRouter,
  comercial: comercialRouter,
  reservations: reservationsRouter,
});

export type AppRouter = typeof appRouter;
