import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";

const db = new PrismaClient();
const COMMUNITY_ID = "cmoky25fo00041026u1nhs0pb";
const ORG_ID       = "cmoky1shn0000a3a65nazzt0z";
const RATE         = "37.50";
const TAG          = "PRUEBA_MIGRACION";

// Simula exactamente lo que hace el mutation bulkImportMigration
const rows = [
  { unitCode: "A-1A",  firstName: "María",   lastName: "González", idType: "CEDULA_V", idNumber: "99100001", email: "maria@test.com",  role: "OWNER", deudaUsd: 100, pagadoUsd: 0,  descripcion: "Cuotas pendientes 2025", fechaVence: "2025-12-31" },
  { unitCode: "A-1B",  firstName: "Pedro",   lastName: "Pérez",    idType: "CEDULA_V", idNumber: "99100002", email: "pedro@test.com",  role: "OWNER", deudaUsd: 50,  pagadoUsd: 20, descripcion: "Deuda acumulada",        fechaVence: "2025-06-30" },
  { unitCode: "A-1C",  firstName: "Empresa", lastName: "SRL",      idType: "RIF",      idNumber: "J-991003", email: "emp@test.com",    role: "OWNER", deudaUsd: 0,   pagadoUsd: 0,  descripcion: "",                       fechaVence: "" },
  { unitCode: "A-1D",  firstName: "Luis",    lastName: "Torres",   idType: "CEDULA_V", idNumber: "99100004", email: null,             role: "OWNER", deudaUsd: 200, pagadoUsd: 0,  descripcion: "3 meses sin pagar",      fechaVence: "2025-11-30" },
];

async function main() {
  console.log("=== PRUEBA DE MIGRACIÓN COMPLETA (Residente + Deuda) ===\n");

  const rateVal = new Decimal(RATE);

  const units = await db.unit.findMany({
    where: { communityId: COMMUNITY_ID, deletedAt: null },
    select: { id: true, code: true },
  });
  const unitMap = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));

  let residents = 0, invoices = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const unitId = unitMap.get(row.unitCode.toLowerCase());
      if (!unitId) { errors.push(`Fila ${i+2}: unidad "${row.unitCode}" no encontrada`); skipped++; continue; }

      // Upsert persona
      const person = await db.person.upsert({
        where: { organizationId_idType_idNumber: { organizationId: ORG_ID, idType: row.idType, idNumber: row.idNumber } },
        update:  { firstName: row.firstName, lastName: row.lastName, email: row.email },
        create:  { organizationId: ORG_ID, idType: row.idType, idNumber: row.idNumber, firstName: row.firstName, lastName: row.lastName, email: row.email },
      });

      // Asignar a unidad
      const exists = await db.ownership.findFirst({ where: { unitId, personId: person.id, endDate: null } });
      if (!exists) await db.ownership.create({ data: { unitId, personId: person.id, sharePercent: "100", startDate: new Date() } });
      residents++;

      // Crear factura de deuda si aplica
      if (row.deudaUsd > 0) {
        const totalUsd = new Decimal(row.deudaUsd);
        const paidUsd  = new Decimal(row.pagadoUsd);
        const totalBss = totalUsd.mul(rateVal);
        const paidBss  = paidUsd.mul(rateVal);
        const dueDate  = row.fechaVence ? new Date(row.fechaVence) : (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d; })();
        const pending  = totalUsd.minus(paidUsd);
        const status   = pending.lte(0) ? "PAID" : paidUsd.gt(0) ? "PARTIAL" : dueDate < new Date() ? "OVERDUE" : "ISSUED";

        await db.invoice.create({ data: {
          organizationId: ORG_ID, communityId: COMMUNITY_ID, unitId,
          invoiceNumber: `IMP-MIG-${String(++invoices).padStart(3,"0")}`,
          periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth()+1,
          issuedAt: new Date(), dueDate,
          totalUsd: totalUsd.toFixed(2), totalBss: totalBss.toFixed(2),
          paidUsd: paidUsd.toFixed(2),   paidBss: paidBss.toFixed(2),
          exchangeRate: RATE, exchangeSource: "MANUAL", currencyPrimary: "USD",
          status, notes: `${TAG} — ${row.firstName} ${row.lastName}`,
          items: { create: [{ description: row.descripcion || `Deuda — ${row.firstName} ${row.lastName}`, amountUsd: totalUsd.toFixed(2), amountBss: totalBss.toFixed(2), aliquot: "0" }] },
        }});
        console.log(`   ✅ ${row.firstName} ${row.lastName} (${row.unitCode}): $${row.deudaUsd} → status ${status}`);
      } else {
        console.log(`   ✅ ${row.firstName} ${row.lastName} (${row.unitCode}): registrado sin deuda`);
      }
    } catch(e) {
      errors.push(`Fila ${i+2}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`  Residentes creados/actualizados: ${residents}`);
  console.log(`  Facturas de deuda generadas:     ${invoices}`);
  console.log(`  Filas con error:                 ${skipped}`);
  if (errors.length) errors.forEach(e => console.log(`  ⚠️  ${e}`));

  // Verificar
  const pTest = await db.person.count({ where: { organizationId: ORG_ID, idNumber: { startsWith: "991000" } } });
  const iTest = await db.invoice.count({ where: { communityId: COMMUNITY_ID, invoiceNumber: { startsWith: "IMP-MIG" } } });
  console.log(`\nVerificación DB: ${pTest} personas, ${iTest} facturas creadas`);
  console.log(residents === 4 && invoices === 3 ? "\n✅ MIGRACIÓN COMPLETA FUNCIONA CORRECTAMENTE" : "\n❌ REVISAR ERRORES");
  console.log("\n👉 Ejecuta scripts/cleanup-migration.mjs para limpiar.");
}

main().then(() => db.$disconnect()).catch(e => { console.error(e.message); db.$disconnect(); process.exit(1); });
