import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, orgProcedure } from "@/server/trpc/init";
import { Decimal } from "decimal.js";

const orgIdInput = z.object({ organizationId: z.string() });

const BOARD_ROLES = ["PRESIDENT", "VICE_PRESIDENT", "TREASURER", "SECRETARY", "VOCAL_1", "VOCAL_2", "VOCAL_3", "ALTERNATE"] as const;
const VIOLATION_TYPES = ["NOISE", "PARKING", "PETS", "COMMON_AREAS", "ELEVATOR_MISUSE", "GARBAGE", "OTHER"] as const;
const DOC_CATEGORIES = ["REGULATION", "MINUTES", "CERTIFICATE", "BUDGET", "CONTRACT", "LEGAL", "OTHER"] as const;

export const governanceRouter = router({

  // ─── Junta directiva ───────────────────────────────────────────
  board: router({
    list: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string(), activeOnly: z.boolean().default(true) }))
      .query(({ ctx, input }) =>
        ctx.db.boardMember.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.activeOnly ? { endDate: null } : {}),
          },
          include: {
            person: { select: { firstName: true, lastName: true, idType: true, idNumber: true, email: true, phone: true } },
          },
          orderBy: { startDate: "desc" },
        }),
      ),

    set: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        personId: z.string(),
        role: z.enum(BOARD_ROLES),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, personId, role, startDate, endDate, notes } = input;
        await ctx.db.person.findFirstOrThrow({ where: { id: personId, organizationId } });
        // Cerrar rol activo anterior del mismo tipo si existe
        await ctx.db.boardMember.updateMany({
          where: { communityId, role, endDate: null },
          data: { endDate: startDate },
        });
        return ctx.db.boardMember.create({
          data: { organizationId, communityId, personId, role, startDate, endDate: endDate ?? null, notes },
        });
      }),

    remove: orgProcedure
      .input(orgIdInput.extend({ communityId: z.string(), memberId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.boardMember.update({
          where: { id: input.memberId },
          data: { endDate: new Date() },
        }),
      ),
  }),

  // ─── Asambleas ─────────────────────────────────────────────────
  assemblies: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        status: z.enum(["SCHEDULED", "IN_PROGRESS", "CLOSED", "CANCELLED"]).optional(),
      }))
      .query(({ ctx, input }) =>
        ctx.db.assembly.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.status ? { status: input.status } : {}),
          },
          include: {
            agendaItems: { orderBy: { order: "asc" } },
            _count: { select: { votes: true } },
          },
          orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        }),
      ),

    byId: orgProcedure
      .input(orgIdInput.extend({ assemblyId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db.assembly.findFirstOrThrow({
          where: { id: input.assemblyId, organizationId: input.organizationId },
          include: {
            agendaItems: {
              orderBy: { order: "asc" },
              include: { votes: { include: { person: { select: { firstName: true, lastName: true } }, unit: { select: { code: true } } } } },
            },
          },
        }),
      ),

    create: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        title: z.string().min(3),
        description: z.string().optional(),
        scheduledAt: z.coerce.date(),
        location: z.string().optional(),
        quorumRequired: z.number().int().min(1).max(100).default(50),
        agendaItems: z.array(z.object({
          order: z.number().int().positive(),
          title: z.string().min(2),
          description: z.string().optional(),
          requiresVote: z.boolean().default(false),
        })).default([]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, communityId, agendaItems, ...data } = input;
        return ctx.db.assembly.create({
          data: {
            organizationId,
            communityId,
            ...data,
            createdById: ctx.user.id,
            agendaItems: agendaItems.length > 0
              ? { create: agendaItems }
              : undefined,
          },
          include: { agendaItems: { orderBy: { order: "asc" } } },
        });
      }),

    update: orgProcedure
      .input(orgIdInput.extend({
        assemblyId: z.string(),
        title: z.string().min(3).optional(),
        description: z.string().optional(),
        scheduledAt: z.coerce.date().optional(),
        location: z.string().optional(),
        quorumRequired: z.number().int().min(1).max(100).optional(),
        status: z.enum(["SCHEDULED", "IN_PROGRESS", "CANCELLED"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, assemblyId, ...data } = input;
        const assembly = await ctx.db.assembly.findFirstOrThrow({
          where: { id: assemblyId, organizationId },
        });
        if (assembly.status === "CLOSED") {
          throw new TRPCError({ code: "CONFLICT", message: "No se puede editar una asamblea cerrada" });
        }
        return ctx.db.assembly.update({ where: { id: assemblyId }, data });
      }),

    addAgendaItem: orgProcedure
      .input(orgIdInput.extend({
        assemblyId: z.string(),
        title: z.string().min(2),
        description: z.string().optional(),
        requiresVote: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, assemblyId, ...data } = input;
        await ctx.db.assembly.findFirstOrThrow({ where: { id: assemblyId, organizationId } });
        const lastItem = await ctx.db.assemblyAgendaItem.findFirst({
          where: { assemblyId },
          orderBy: { order: "desc" },
        });
        return ctx.db.assemblyAgendaItem.create({
          data: { assemblyId, order: (lastItem?.order ?? 0) + 1, ...data },
        });
      }),

    recordResult: orgProcedure
      .input(orgIdInput.extend({
        agendaItemId: z.string(),
        result: z.string().optional(),
        approved: z.boolean().optional(),
      }))
      .mutation(({ ctx, input }) =>
        ctx.db.assemblyAgendaItem.update({
          where: { id: input.agendaItemId },
          data: { result: input.result, approved: input.approved },
        }),
      ),

    vote: orgProcedure
      .input(orgIdInput.extend({
        assemblyId: z.string(),
        agendaItemId: z.string(),
        unitId: z.string(),
        personId: z.string(),
        choice: z.enum(["FOR", "AGAINST", "ABSTAIN"]),
        comment: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, assemblyId, agendaItemId, unitId, personId, choice, comment } = input;

        const [assembly, item] = await Promise.all([
          ctx.db.assembly.findFirstOrThrow({ where: { id: assemblyId, organizationId } }),
          ctx.db.assemblyAgendaItem.findFirstOrThrow({ where: { id: agendaItemId, assemblyId } }),
        ]);
        if (assembly.status === "CLOSED" || assembly.status === "CANCELLED") {
          throw new TRPCError({ code: "CONFLICT", message: "La asamblea no está activa" });
        }
        if (!item.requiresVote) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este punto no requiere votación" });
        }

        return ctx.db.$transaction(async (tx) => {
          // upsert: si ya votó, actualizar
          const existing = await tx.assemblyVote.findUnique({
            where: { agendaItemId_unitId: { agendaItemId, unitId } },
          });

          if (existing) {
            // restar voto anterior
            await tx.assemblyAgendaItem.update({
              where: { id: agendaItemId },
              data: {
                votesFor:     existing.choice === "FOR"     ? { decrement: 1 } : undefined,
                votesAgainst: existing.choice === "AGAINST" ? { decrement: 1 } : undefined,
                votesAbstain: existing.choice === "ABSTAIN" ? { decrement: 1 } : undefined,
              },
            });
            await tx.assemblyVote.update({
              where: { id: existing.id },
              data: { choice, comment },
            });
          } else {
            await tx.assemblyVote.create({
              data: { assemblyId, agendaItemId, unitId, personId, choice, comment },
            });
          }

          // sumar nuevo voto
          await tx.assemblyAgendaItem.update({
            where: { id: agendaItemId },
            data: {
              votesFor:     choice === "FOR"     ? { increment: 1 } : undefined,
              votesAgainst: choice === "AGAINST" ? { increment: 1 } : undefined,
              votesAbstain: choice === "ABSTAIN" ? { increment: 1 } : undefined,
            },
          });

          return tx.assemblyAgendaItem.findUniqueOrThrow({ where: { id: agendaItemId } });
        });
      }),

    close: orgProcedure
      .input(orgIdInput.extend({
        assemblyId: z.string(),
        attendeesCount: z.number().int().min(0),
        quorumReached: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, assemblyId, attendeesCount, quorumReached } = input;
        const assembly = await ctx.db.assembly.findFirstOrThrow({
          where: { id: assemblyId, organizationId },
        });
        if (assembly.status === "CLOSED") {
          throw new TRPCError({ code: "CONFLICT", message: "Ya está cerrada" });
        }
        return ctx.db.assembly.update({
          where: { id: assemblyId },
          data: { status: "CLOSED", closedAt: new Date(), attendeesCount, quorumReached },
        });
      }),

    generateMinutesPdf: orgProcedure
      .input(orgIdInput.extend({ assemblyId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, assemblyId } = input;
        const [assembly, community] = await Promise.all([
          ctx.db.assembly.findFirstOrThrow({
            where: { id: assemblyId, organizationId },
            include: { agendaItems: { orderBy: { order: "asc" } } },
          }),
          ctx.db.community.findFirstOrThrow({
            where: { organizationId },
            select: { name: true, address: true, rif: true, totalUnits: true },
          }),
        ]);

        // Presidente activo
        const president = await ctx.db.boardMember.findFirst({
          where: { communityId: assembly.communityId, role: "PRESIDENT", endDate: null },
          include: { person: { select: { firstName: true, lastName: true } } },
        });

        const { generateAssemblyMinutesPdf } = await import("@/server/services/pdf");
        const buffer = await generateAssemblyMinutesPdf({
          communityName: community.name,
          communityAddress: community.address ?? undefined,
          assemblyTitle: assembly.title,
          scheduledAt: assembly.scheduledAt,
          location: assembly.location ?? undefined,
          quorumRequired: assembly.quorumRequired,
          quorumReached: assembly.quorumReached,
          attendeesCount: assembly.attendeesCount,
          totalUnits: community.totalUnits,
          status: assembly.status,
          agendaItems: assembly.agendaItems.map((it) => ({
            order: it.order,
            title: it.title,
            description: it.description,
            requiresVote: it.requiresVote,
            result: it.result,
            votesFor: it.votesFor,
            votesAgainst: it.votesAgainst,
            votesAbstain: it.votesAbstain,
            approved: it.approved,
          })),
          boardPresident: president ? `${president.person.firstName} ${president.person.lastName}` : undefined,
        });

        // Devolver como base64 para que el frontend genere la descarga
        return { base64: buffer.toString("base64"), fileName: `acta-${assemblyId}.pdf` };
      }),
  }),

  // ─── Certificado de no-adeudo ───────────────────────────────────
  nonDebtCert: orgProcedure
    .input(orgIdInput.extend({
      communityId: z.string(),
      unitId: z.string(),
      validDays: z.number().int().min(1).max(90).default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, communityId, unitId, validDays } = input;

      const [unit, community, ownership, invoices] = await Promise.all([
        ctx.db.unit.findFirstOrThrow({
          where: { id: unitId, communityId, organizationId, deletedAt: null },
        }),
        ctx.db.community.findFirstOrThrow({
          where: { id: communityId, organizationId },
          select: { name: true, address: true, rif: true, totalUnits: true },
        }),
        ctx.db.ownership.findFirst({
          where: { unitId, endDate: null },
          include: { person: { select: { firstName: true, lastName: true, idType: true, idNumber: true } } },
        }),
        ctx.db.invoice.findMany({
          where: { unitId, status: { not: "VOIDED" } },
          select: { totalUsd: true, totalBss: true, paidUsd: true, paidBss: true },
        }),
      ]);

      const balanceUsd = invoices.reduce(
        (s, i) => s.plus(i.totalUsd.toString()).minus(i.paidUsd.toString()),
        new Decimal(0),
      );
      const balanceBss = invoices.reduce(
        (s, i) => s.plus(i.totalBss.toString()).minus(i.paidBss.toString()),
        new Decimal(0),
      );

      // Presidente activo
      const president = await ctx.db.boardMember.findFirst({
        where: { communityId, role: "PRESIDENT", endDate: null },
        include: { person: { select: { firstName: true, lastName: true } } },
      });

      const certDate = new Date();
      const validUntil = new Date(certDate);
      validUntil.setDate(validUntil.getDate() + validDays);

      const { generateNonDebtCertPdf } = await import("@/server/services/pdf");
      const buffer = await generateNonDebtCertPdf({
        communityName: community.name,
        communityAddress: community.address ?? undefined,
        communityRif: community.rif ?? undefined,
        unitCode: unit.code,
        unitFloor: unit.floor,
        unitTower: unit.tower,
        ownerName: ownership ? `${ownership.person.firstName} ${ownership.person.lastName}` : "Sin propietario registrado",
        ownerIdNumber: ownership?.person.idNumber,
        ownerIdType: ownership?.person.idType,
        balanceUsd: balanceUsd.toFixed(2),
        balanceBss: balanceBss.toFixed(2),
        hasDebt: balanceUsd.gt(0.005),
        certDate,
        validUntilDate: validUntil,
        boardPresident: president ? `${president.person.firstName} ${president.person.lastName}` : undefined,
      });

      return {
        base64: buffer.toString("base64"),
        fileName: `solvencia-${unit.code}-${certDate.toISOString().slice(0, 10)}.pdf`,
        hasDebt: balanceUsd.gt(0.005),
        balanceUsd: balanceUsd.toFixed(2),
      };
    }),

  // ─── Repositorio documental ─────────────────────────────────────
  documents: router({
    list: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        category: z.enum(DOC_CATEGORIES).optional(),
      }))
      .query(({ ctx, input }) =>
        ctx.db.communityDocument.findMany({
          where: {
            organizationId: input.organizationId,
            communityId: input.communityId,
            ...(input.category ? { category: input.category } : {}),
          },
          include: {
            uploadedBy: { select: { name: true } },
            assembly: { select: { title: true, scheduledAt: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
      ),

    create: orgProcedure
      .input(orgIdInput.extend({
        communityId: z.string(),
        category: z.enum(DOC_CATEGORIES),
        title: z.string().min(2),
        description: z.string().optional(),
        fileUrl: z.string().min(1),
        fileName: z.string().min(1),
        fileSizeBytes: z.number().int().positive().optional(),
        mimeType: z.string().optional(),
        assemblyId: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { organizationId, communityId, ...data } = input;
        return ctx.db.communityDocument.create({
          data: {
            organizationId,
            communityId,
            ...data,
            uploadedById: ctx.user.id,
          },
        });
      }),

    delete: orgProcedure
      .input(orgIdInput.extend({ documentId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.db.communityDocument.delete({
          where: { id: input.documentId },
        }),
      ),
  }),
});
