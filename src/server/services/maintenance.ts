import { db } from "@/server/db/client";
import type { WorkOrderStatus, WorkOrderPriority, ExpenseCategory } from "@prisma/client";

interface CreateWorkOrderInput {
  organizationId: string;
  communityId: string;
  unitId?: string;
  title: string;
  description: string;
  category: ExpenseCategory;
  priority?: WorkOrderPriority;
  estimatedCostUsd?: number;
  scheduledAt?: Date;
  reportedById?: string;
  notes?: string;
}

export async function createWorkOrder(input: CreateWorkOrderInput) {
  return db.workOrder.create({
    data: {
      organizationId: input.organizationId,
      communityId: input.communityId,
      unitId: input.unitId,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority ?? "MEDIUM",
      status: "OPEN",
      estimatedCostUsd: input.estimatedCostUsd,
      scheduledAt: input.scheduledAt,
      reportedById: input.reportedById,
      notes: input.notes,
    },
    include: { unit: { select: { code: true } }, contractor: true },
  });
}

interface UpdateWorkOrderInput {
  workOrderId: string;
  organizationId: string;
  status?: WorkOrderStatus;
  contractorId?: string | null;
  priority?: WorkOrderPriority;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  scheduledAt?: Date;
  notes?: string;
  actorId?: string;
}

export async function updateWorkOrder(input: UpdateWorkOrderInput) {
  const wo = await db.workOrder.findFirstOrThrow({
    where: { id: input.workOrderId, organizationId: input.organizationId },
  });

  const now = new Date();
  const updates: Record<string, unknown> = {};

  if (input.status && input.status !== wo.status) {
    updates.status = input.status;
    if (input.status === "ASSIGNED" || input.status === "IN_PROGRESS") {
      updates.assignedAt = wo.assignedAt ?? now;
    }
    if (input.status === "COMPLETED") {
      updates.completedAt = now;
    }
    await db.workOrderActivity.create({
      data: {
        workOrderId: wo.id,
        actorId: input.actorId,
        type: "STATUS_CHANGE",
        content: `Estado cambiado de ${wo.status} a ${input.status}`,
      },
    });
  }

  if ("contractorId" in input) updates.contractorId = input.contractorId;
  if (input.priority) updates.priority = input.priority;
  if (input.estimatedCostUsd !== undefined) updates.estimatedCostUsd = input.estimatedCostUsd;
  if (input.actualCostUsd !== undefined) updates.actualCostUsd = input.actualCostUsd;
  if (input.scheduledAt) updates.scheduledAt = input.scheduledAt;
  if (input.notes !== undefined) updates.notes = input.notes;

  return db.workOrder.update({
    where: { id: wo.id },
    data: updates,
    include: { unit: { select: { code: true } }, contractor: true },
  });
}

export async function addWorkOrderNote(params: {
  workOrderId: string;
  organizationId: string;
  content: string;
  actorId?: string;
}) {
  await db.workOrder.findFirstOrThrow({
    where: { id: params.workOrderId, organizationId: params.organizationId },
  });
  return db.workOrderActivity.create({
    data: {
      workOrderId: params.workOrderId,
      actorId: params.actorId,
      type: "NOTE",
      content: params.content,
    },
  });
}
