import { z } from "zod";
import { router, orgProcedure } from "@/server/trpc/init";
import { createWorkOrder, updateWorkOrder, addWorkOrderNote } from "@/server/services/maintenance";

const orgIdInput = z.object({ organizationId: z.string() });

const EXPENSE_CATEGORIES = [
  "ELECTRICITY", "WATER", "GAS", "INTERNET", "CLEANING", "GARDENING",
  "SECURITY", "ELEVATOR", "STAFF_PAYROLL", "ADMINISTRATION", "INSURANCE",
  "REPAIRS", "RESERVE_FUND", "TAXES", "OTHER",
] as const;

const WO_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const WO_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const maintenanceRouter = router({
  // ─── Contratistas ──────────────────────────────────────────────
  contractors: router({
    list: orgProcedure
      .input(orgIdInput.extend({ includeInactive: z.boolean().default(false) }))
      .query(({ ctx, input }) =>
        ctx.db.contractor.findMany({
          where: {
            organizationId: input.organizationId,
            ...(input.includeInactive ? {} : { active: true }),
          },
          orderBy: { name: "asc" },
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          name: z.string().min(2),
          specialty: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.contractor.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            specialty: input.specialty,
            phone: input.phone,
            email: input.email,
            notes: input.notes,
          },
        }),
      ),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          name: z.string().min(2).optional(),
          specialty: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().email().optional(),
          rating: z.number().min(0).max(5).optional(),
          active: z.boolean().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db.contractor.update({
          where: { id: input.id },
          data: {
            name: input.name,
            specialty: input.specialty,
            phone: input.phone,
            email: input.email,
            rating: input.rating,
            active: input.active,
            notes: input.notes,
          },
        }),
      ),
  }),

  // ─── Work Orders ───────────────────────────────────────────────
  workOrders: router({
    list: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          status: z.enum(WO_STATUSES).optional(),
          priority: z.enum(WO_PRIORITIES).optional(),
          unitId: z.string().optional(),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db.workOrder.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
            ...(input.unitId ? { unitId: input.unitId } : {}),
          },
          include: {
            unit: { select: { code: true, floor: true, tower: true } },
            contractor: { select: { name: true } },
            _count: { select: { activities: true } },
          },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        }),
      ),
    byId: orgProcedure
      .input(orgIdInput.extend({ id: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.workOrder.findFirstOrThrow({
          where: { id: input.id, organizationId: input.organizationId },
          include: {
            unit: { select: { code: true, floor: true, tower: true } },
            contractor: true,
            activities: { orderBy: { createdAt: "asc" } },
          },
        }),
      ),
    create: orgProcedure
      .input(
        orgIdInput.extend({
          communityId: z.string(),
          unitId: z.string().optional(),
          title: z.string().min(3),
          description: z.string().min(5),
          category: z.enum(EXPENSE_CATEGORIES),
          priority: z.enum(WO_PRIORITIES).default("MEDIUM"),
          estimatedCostUsd: z.number().positive().optional(),
          scheduledAt: z.coerce.date().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        createWorkOrder({ ...input, reportedById: ctx.user.id }),
      ),
    update: orgProcedure
      .input(
        orgIdInput.extend({
          id: z.string(),
          status: z.enum(WO_STATUSES).optional(),
          contractorId: z.string().nullable().optional(),
          priority: z.enum(WO_PRIORITIES).optional(),
          estimatedCostUsd: z.number().positive().optional(),
          actualCostUsd: z.number().positive().optional(),
          scheduledAt: z.coerce.date().optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        updateWorkOrder({
          workOrderId: input.id,
          organizationId: input.organizationId,
          status: input.status,
          contractorId: input.contractorId,
          priority: input.priority,
          estimatedCostUsd: input.estimatedCostUsd,
          actualCostUsd: input.actualCostUsd,
          scheduledAt: input.scheduledAt,
          notes: input.notes,
          actorId: ctx.user.id,
        }),
      ),
    addNote: orgProcedure
      .input(
        orgIdInput.extend({
          workOrderId: z.string(),
          content: z.string().min(2),
        }),
      )
      .mutation(({ ctx, input }) =>
        addWorkOrderNote({
          workOrderId: input.workOrderId,
          organizationId: input.organizationId,
          content: input.content,
          actorId: ctx.user.id,
        }),
      ),
  }),
});
