/**
 * RESET + CARGA REAL Castaños B desde Excel "BASE DATOS ACTUALIZADA JUNIO 2026".
 *
 * Reemplaza toda la data demo previa con los 94 propietarios reales del Excel.
 *
 * Pasos:
 *  1. Limpia data demo: anula facturas, anula gastos, borra ownerships, soft-deletes
 *     units y persons con marker SEED-* (las que cargué en sesiones anteriores).
 *  2. Crea 94 unidades reales (B-011..B-234 + B-PH1, B-PH2) con alícuotas correctas.
 *  3. Crea 94 Person reales con email + WhatsApp normalizado.
 *  4. Crea 94 Ownership 100%.
 *  5. Crea 94 Invoice de mayo 2026 con la deuda de $29.38 c/u (OVERDUE).
 *
 * Llamada one-shot. Borrar después.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const COMMUNITY_ID = "cmoukqntu00015niqpsjlu4cw";

const PROPS = [
  { apto: 'B-011', nombre: 'FRANCISCO A. VILLARROEL M.', email: 'movicainmuebles@gmail.com', cel: '424-1409488', deuda: 29.38 },
  { apto: 'B-012', nombre: 'RAMON ELIGIO OJEDA RODRIGUEZ', email: 'geografia1980@gmail.com', cel: '416-4271755', deuda: 29.38 },
  { apto: 'B-013', nombre: 'VIRGINIA CARRERO UGARTE', email: 'luiscabonilla67@gmail.com', cel: '414-2567387', deuda: 29.38 },
  { apto: 'B-014', nombre: 'CONSUELO GAVIDIA', email: 'mariabustamantems@hotmail.com', cel: '424-2871386', deuda: 29.38 },
  { apto: 'B-021', nombre: 'PEDRO JESUS VIVAS', email: 'kingzhen1984@gmail.com', cel: '412-0129917', deuda: 29.38 },
  { apto: 'B-022', nombre: 'JESÚS OLIVIA ÁVILA', email: 'jolivia53@hotmail.com', cel: '424-2020340', deuda: 29.38 },
  { apto: 'B-023', nombre: 'JOHANA MILAGROS SISCO', email: 'graserp@gmail.com', cel: '54 9 11 6535-8806', deuda: 29.38 },
  { apto: 'B-024', nombre: 'RUBEN ARTURO ROJAS DAVILA', email: 'rrojasd3@gmail.com', cel: '414-0254520', deuda: 29.38 },
  { apto: 'B-031', nombre: 'RITA C. GUILARTE', email: 'ritaceciliaguilarte@gmail.com', cel: '414-3022510', deuda: 29.38 },
  { apto: 'B-032', nombre: 'RAMON JOSE TERAN SILVA', email: 'rteranasesoria@gmail.com', cel: '416-6111202', deuda: 29.38 },
  { apto: 'B-033', nombre: 'BLAS RAMOS Y DISEREE CABRERA', email: 'abgdesireecabrera@gmail.com', cel: '424-2715143', deuda: 29.38 },
  { apto: 'B-034', nombre: 'OSCAR BARRETO', email: 'orbarretomora@gmail.com', cel: '412-3053350', deuda: 29.38 },
  { apto: 'B-041', nombre: 'REINA BELEM DE PEREZ', email: 'reinabelem31@gmail.com', cel: '414-2817985', deuda: 29.38 },
  { apto: 'B-042', nombre: 'ALFREDO TAQUIL GONZALEZ', email: 'alfreta-40@hotmail.com', cel: '414-1413059', deuda: 29.38 },
  { apto: 'B-043', nombre: 'JOSÉ LUIS APONTE', email: 'Jlapontec123@hotmail.com', cel: '424-1621337', deuda: 29.38 },
  { apto: 'B-044', nombre: 'XIOMARA N. BETANCOURT DE MARTINÓ', email: 'martinoaugusto@hotmail.com', cel: '412-6008834', deuda: 29.38 },
  { apto: 'B-051', nombre: 'MELANIA ÁVILA', email: 'melaniaavila0802@gmail.com', cel: '414-3093795', deuda: 29.38 },
  { apto: 'B-052', nombre: 'JOSE H. GUAITA VELASQUEZ', email: 'guaitajosehumberto@gmail.com', cel: '424-2749428', deuda: 29.38 },
  { apto: 'B-053', nombre: 'YADIRA JOSEFINA ALIZO CASTILLO', email: 'yadiraj2012@gmail.com', cel: '414-3325461', deuda: 29.38 },
  { apto: 'B-054', nombre: 'ELINOR MEDINA CORDERO', email: 'alangmm02@gmail.com', cel: '424-2818860', deuda: 29.38 },
  { apto: 'B-061', nombre: 'OCTAVIO RAUL MOTA', email: 'eume13@hotmail.com', cel: '414-8743154', deuda: 29.38 },
  { apto: 'B-062', nombre: 'ALFREDO REYES M', email: 'airm37@yahoo.es', cel: '416-6205054', deuda: 29.38 },
  { apto: 'B-063', nombre: 'CESAR INFANTE', email: 'tecnicainfante@hotmail.com', cel: '414-2934020', deuda: 29.38 },
  { apto: 'B-064', nombre: 'ROSDELY DEL VALLE LARES ROJAS', email: 'rdevlr@hotmail.com', cel: '412-5537721', deuda: 29.38 },
  { apto: 'B-071', nombre: 'JESUS ANTONIO TABATA R.', email: 'jesustabata2@gmail.com', cel: '424-1732685', deuda: 29.38 },
  { apto: 'B-072', nombre: 'COSME DE GONZALEZ HERNANDEZ', email: 'gyaneth639@gmail.com', cel: '414-3000041', deuda: 29.38 },
  { apto: 'B-073', nombre: 'LUISA VICENTA DE SILVA', email: 'luisaargottesilva123@gmail.com', cel: '414-1394923', deuda: 29.38 },
  { apto: 'B-074', nombre: 'GLADYS SUAREZ', email: 'eve_lin90@hotmail.com', cel: '424-1839673', deuda: 29.38 },
  { apto: 'B-081', nombre: 'ROSA DEL CARMEN VIVAS SANCHEZ', email: 'livia.alas.vivas@gmail.com', cel: '426-2660907', deuda: 29.38 },
  { apto: 'B-082', nombre: 'JOSE MANUEL BOTANA', email: 'josebrodri.1982@gmail.com', cel: '412-7197420', deuda: 29.38 },
  { apto: 'B-083', nombre: 'MARIELIZA MARCANO / LUIS MARCANO', email: 'marcanomari1104@gmail.com', cel: '424-1213034', deuda: 29.38 },
  { apto: 'B-084', nombre: 'GUSTAVO A LARA SOFFIA', email: 'yumairakat@gmail.com', cel: '424-7096884', deuda: 29.38 },
  { apto: 'B-091', nombre: 'Anaiz Rossenyz Herández P', email: 'Delizhernandez94@gmail.com', cel: '1 754 2985890', deuda: 29.38 },
  { apto: 'B-092', nombre: 'IRMA B. HERNADEZ DE MARTINEZ', email: 'irmabeatrizmh@hotmail.com', cel: '412-0148314', deuda: 29.38 },
  { apto: 'B-093', nombre: 'LUISA CARVAJAL', email: 'luidelva49@hotmail.com', cel: '416-6114710', deuda: 29.38 },
  { apto: 'B-094', nombre: 'MANUEL DELGADO QUINTERO', email: 'rrivero0@hotmail.com', cel: '1 (801) 750-8600', deuda: 29.38 },
  { apto: 'B-101', nombre: 'YASELYS DEL CARMEN CHAURAN', email: 'ychauran_laya@hotmail.com', cel: '416-9063173', deuda: 29.38 },
  { apto: 'B-102', nombre: 'FREDYS FIGUERA', email: 'jesusgonzalez197405@hotmail.com', cel: '426-5182000', deuda: 29.38 },
  { apto: 'B-103', nombre: 'JORGE GARCIA', email: 'jorgeagarcias70.jg@gmail.com', cel: '414-1299057', deuda: 29.38 },
  { apto: 'B-104', nombre: 'CARMEN SANTANA RODRÍGUEZ', email: 'meicasantana@hotmail.com', cel: '34 690 70 11 77', deuda: 29.38 },
  { apto: 'B-111', nombre: 'DUNIA COROMOTO ACEITUNO', email: 'aceitunodunia@gmail.com', cel: '424-1974663', deuda: 29.38 },
  { apto: 'B-112', nombre: 'JOSE TORRES', email: 'marleni_detorres@hotmail.com', cel: '34 691 68 47 40', deuda: 29.38 },
  { apto: 'B-113', nombre: 'RAFAEL Y DIANA DE REYES', email: 'maireth_mendoza@hotmail.com', cel: '414-2600938', deuda: 29.38 },
  { apto: 'B-114', nombre: 'MIRNA LUZ GRATEROL TREJO', email: 'mlgraterol1952@gmail.com', cel: '412-3643045', deuda: 29.38 },
  { apto: 'B-121', nombre: "FRANCO D'AGOSTINO Y ANGELA M.", email: 'mayaco2009@hotmail.com', cel: '414-2071549', deuda: 29.38 },
  { apto: 'B-122', nombre: 'JAIRO ORLANDO JAIMES DUARTE', email: 'jaorja2007@gmail.com', cel: '424-1695889', deuda: 29.38 },
  { apto: 'B-123', nombre: 'RAFAEL DELGADO', email: 'leida_rivero1977@hotmail.com', cel: '414-2392142', deuda: 29.38 },
  { apto: 'B-124', nombre: 'ESMELI ROJAS BOLIVAR', email: 'lcanizares@alenet.com', cel: '414-3655951', deuda: 29.38 },
  { apto: 'B-131', nombre: 'LEONOR HIPÓLITO', email: 'lhipol2012@gmail.com', cel: '424-2194403', deuda: 29.38 },
  { apto: 'B-132', nombre: 'YAMILET CAVET', email: 'stephanievnc8@gmail.com', cel: '414-2382601', deuda: 29.38 },
  { apto: 'B-133', nombre: 'MARI DÍAZ', email: 'credisavicepresident@gmail.com', cel: '414-3347878', deuda: 29.38 },
  { apto: 'B-134', nombre: 'ADRIANY MORALES', email: 'adrianymorales17@gmail.com', cel: '424-1738174', deuda: 29.38 },
  { apto: 'B-141', nombre: 'TULA MARÍN', email: 'bereniceacostamarin@gmail.com', cel: '414-2089218', deuda: 29.38 },
  { apto: 'B-142', nombre: 'CRISTINA GONZÁLEZ', email: 'Fg7250748@gmail.com', cel: '424-1515697', deuda: 29.38 },
  { apto: 'B-143', nombre: 'MARCOS REYES', email: 'marcosreyes2410@gmail.com', cel: '412-7115834', deuda: 29.38 },
  { apto: 'B-144', nombre: 'JOSEFA LUQUE', email: 'marcanoluque@gmail.com', cel: '416-4023968', deuda: 29.38 },
  { apto: 'B-151', nombre: 'CARLOS E LOPEZ', email: 'elosopolar@hotmail.com', cel: '412-6133480', deuda: 29.38 },
  { apto: 'B-152', nombre: 'MERCEDES MARIA ROJAS DE RUIZ', email: 'ruiznumidia@gmail.com', cel: '414-2449200', deuda: 29.38 },
  { apto: 'B-153', nombre: 'HAIDEE MONSALVE Y MIGUEL DIAZ', email: 'yamileth.monsalve@gmail.com', cel: '54 9 11 6964-9879', deuda: 29.38 },
  { apto: 'B-154', nombre: 'MARLON PAREDES MARY TORRES', email: 'cerebrinmarlon@gmail.com', cel: '414-9034592', deuda: 29.38 },
  { apto: 'B-161', nombre: 'KATIUSKA A. CASTILLO', email: 'asistente.nat25@gmail.com', cel: '424-1895258', deuda: 29.38 },
  { apto: 'B-162', nombre: 'EMILIO FREDDY ESPINEL', email: 'espinelfasesor@hotmail.com', cel: '414-3180624', deuda: 29.38 },
  { apto: 'B-163', nombre: 'SAMIRA DER BOGHOSSIAN DE BELLO', email: 'margarette8387@gmail.com', cel: '424-1531467', deuda: 29.38 },
  { apto: 'B-164', nombre: 'YOEL JESUS SIERRALTA', email: 'eiselena@gmail.com', cel: '414-2321920', deuda: 29.38 },
  { apto: 'B-171', nombre: 'RAFAEL LORENZO COLMENARE', email: 'rcolmenares11@gmail.com', cel: '414-3003121', deuda: 29.38 },
  { apto: 'B-172', nombre: 'JORGE ENRIQUE VASQUEZ', email: 'ailinvasquez@gmail.com', cel: '424-1858433', deuda: 29.38 },
  { apto: 'B-173', nombre: 'DAVID RAFAEL DIAZ P.', email: 'tcentenod@yahoo.es', cel: '424-1992095', deuda: 29.38 },
  { apto: 'B-174', nombre: 'ALFONSO THEIS', email: 'theisalfonso@gmail.com', cel: '412-5557053', deuda: 29.38 },
  { apto: 'B-181', nombre: 'JUAN FRANCISCO ARELLANO', email: 'jfamda1@gmail.com', cel: '414-0333895', deuda: 29.38 },
  { apto: 'B-182', nombre: 'MAGALY ABOUD SOL DE FRAIZ', email: 'joseomarvizcardoccs.ny@gmail.com', cel: '424-1883751', deuda: 29.38 },
  { apto: 'B-183', nombre: 'FRANCO ELI RODRIGUEZ NIETO', email: 'franco_nieto@hotmail.com', cel: '414-1390690', deuda: 29.38 },
  { apto: 'B-184', nombre: 'DINO MUÑOZ CAVALIERI', email: 'afranco69@gmail.com', cel: '412-8083859', deuda: 29.38 },
  { apto: 'B-191', nombre: 'EMMA DE RUMBOS Y ALIRIO RUMBOS', email: 'aliriorumbosabc@gmail.com', cel: '414-4745032', deuda: 29.38 },
  { apto: 'B-192', nombre: 'RIGOBERTO HERNANDEZ', email: 'rigobertoh333@hotmail.com', cel: '424-1819762', deuda: 29.38 },
  { apto: 'B-193', nombre: 'VICTOR RENGIFO ROMERO', email: 'melissagarcia0203@gmail.com', cel: '412-3104602', deuda: 29.38 },
  { apto: 'B-194', nombre: 'ROSA HIDALGO', email: 'wbrice04@gmail.com', cel: '414-1282878', deuda: 29.38 },
  { apto: 'B-201', nombre: 'Aguasanta Hernández', email: 'zoraidaalejandra@gmail.com', cel: '1 (517) 677-9130', deuda: 29.38 },
  { apto: 'B-202', nombre: 'HIRWING DEL CARMEN GONZALEZ', email: 'hirwinghga@gmail.com', cel: '414-2891160', deuda: 29.38 },
  { apto: 'B-203', nombre: 'GONZALO GUILLERMO URGUELLES', email: 'gus10149@gmail.com', cel: '424-2296969', deuda: 29.38 },
  { apto: 'B-204', nombre: 'GERARDO MENESES', email: 'gmgmeneses@gmail.com', cel: '414-2462607', deuda: 29.38 },
  { apto: 'B-211', nombre: 'KARINA ALVAREZ', email: 'Alvarezkaylen@gmail.com', cel: '414-2316344', deuda: 29.38 },
  { apto: 'B-212', nombre: 'JOSE ANGEL CARDENAS CHAUSTRE', email: 'jeronimo.escobar@hotmail.com', cel: '1 (469) 644-3645', deuda: 29.38 },
  { apto: 'B-213', nombre: 'JESUS RAFAEL GONZALEZ', email: 'jesusrafaelgm@hotmail.com', cel: '414-3059628', deuda: 29.38 },
  { apto: 'B-214', nombre: 'MARÍA LUISA VALENTE', email: 'mary.chiquita@gmail.com', cel: '414-4452155', deuda: 29.38 },
  { apto: 'B-221', nombre: 'LUISA BETANCOURT', email: 'duce1505@hotmail.com', cel: '57 320 9178126', deuda: 29.38 },
  { apto: 'B-222', nombre: 'GIOVANNI PEREZ', email: 'giovanni17_12_dys@hotmail.com', cel: '424-2900485', deuda: 29.38 },
  { apto: 'B-223', nombre: 'MATILDE DEL VALLE FIGUERA', email: 'delvalle.matilde@gmail.com', cel: '424-1748203', deuda: 29.38 },
  { apto: 'B-224', nombre: 'ZULLY MARA CEPEDA DE YEGRES', email: '', cel: '', deuda: 29.38 },
  { apto: 'B-231', nombre: 'JUDITH T. GUEDEZ GARCIA', email: 'gjudith@hotmail.com', cel: '414-0191215', deuda: 29.38 },
  { apto: 'B-232', nombre: 'JOAN LEMUEL GONZALEZ FERREIRA', email: 'joanlgonzalezf@gmail.com', cel: '424-2801319', deuda: 29.38 },
  { apto: 'B-233', nombre: 'ARGENIS RODRÍGUEZ', email: 'argenis.rod.gon@gmail.com', cel: '34 687 13 53 62', deuda: 29.38 },
  { apto: 'B-234', nombre: 'LEONARDO DEAN MARIA RAMIREZ', email: 'urdanetayp@gmail.com', cel: '414-3355375', deuda: 29.38 },
  { apto: 'B-PH1', nombre: 'DENYS RODRIGUEZ', email: 'Denys084@gmail.com', cel: '412-9532889', deuda: 29.38 },
  { apto: 'B-PH2', nombre: 'MAITTE HERNANDEZ', email: 'hernandezmaitte@gmail.com', cel: '1 786 548-8238', deuda: 29.38 },
];

// Split "JOSE H. GUAITA VELASQUEZ" -> firstName="JOSE H.", lastName="GUAITA VELASQUEZ"
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] };
  // 3+: nombre = primeras 1-2 palabras (incluyendo iniciales con ".")
  const mid = parts[1]!.endsWith(".") || parts[1]!.length <= 2 ? 2 : 1;
  return {
    firstName: parts.slice(0, mid).join(" "),
    lastName: parts.slice(mid).join(" "),
  };
}

// Normalizar teléfono a 58XXXXXXXXXX (VE). Si trae código de otro país (1=US/CA,
// 34=ES, 54=AR, 57=CO), preservar.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("58") && digits.length >= 11) return digits;
  if (digits.startsWith("1") && digits.length >= 11) return digits;       // US/CA
  if (digits.startsWith("34") && digits.length >= 11) return digits;      // ES
  if (digits.startsWith("54") && digits.length >= 12) return digits;      // AR
  if (digits.startsWith("57") && digits.length >= 12) return digits;      // CO
  // Asumir VE móvil local: 04XX-XXXXXXX -> 58 4XX...
  if (digits.startsWith("0")) return `58${digits.slice(1)}`;
  if (digits.length === 10) return `58${digits}`;
  return digits;
}

// B-011 -> floor=1, B-234 -> floor=23, B-PH1 -> floor=24
function getFloor(apto: string): number {
  if (apto.includes("PH")) return 24;
  const m = apto.match(/B-(\d{2})\d/);
  return m ? parseInt(m[1]!, 10) : 1;
}

// Alícuotas según el Excel: 1.06383% para 011-234, 2.12766% para PH1/PH2
function getAliquot(apto: string): string {
  return apto.includes("PH") ? "2.127660" : "1.063830";
}

export async function GET() {
  const summary = {
    voidedInvoices: 0,
    voidedExpenses: 0,
    deletedOwnerships: 0,
    deletedUnits: 0,
    deletedPersons: 0,
    createdUnits: 0,
    createdPersons: 0,
    createdOwnerships: 0,
    createdInvoices: 0,
    skipped: [] as string[],
  };

  const community = await db.community.findUnique({
    where: { id: COMMUNITY_ID },
    select: { id: true, organizationId: true, name: true },
  });
  if (!community) return NextResponse.json({ error: "community not found" }, { status: 404 });
  const orgId = community.organizationId;

  // ── 1. LIMPIEZA ───────────────────────────────────────────────────────────
  // 1a. Anular todas las Invoices activas del condominio
  const inv = await db.invoice.updateMany({
    where: { communityId: COMMUNITY_ID, status: { not: "VOIDED" } },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: "Reset Castaños — carga real desde Excel jun/2026" },
  });
  summary.voidedInvoices = inv.count;

  // 1b. Anular todos los Expense activos del condominio
  const exp = await db.expense.updateMany({
    where: { communityId: COMMUNITY_ID, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: "Reset Castaños — carga real desde Excel jun/2026" },
  });
  summary.voidedExpenses = exp.count;

  // 1c. Borrar todas las Ownership de las unidades del condominio
  // Incluir TODAS las units (activas + soft-deleted) para liberar el unique code.
  const units = await db.unit.findMany({
    where: { communityId: COMMUNITY_ID },
    select: { id: true, code: true },
  });
  const unitIds = units.map((u) => u.id);
  const own = await db.ownership.deleteMany({ where: { unitId: { in: unitIds } } });
  summary.deletedOwnerships = own.count;

  // 1d. Renombrar y soft-delete todas las Units del condominio. Renombrado con
  // sufijo único para liberar el unique constraint (communityId, code) y poder
  // crear las nuevas con los mismos códigos.
  const stamp = Date.now().toString(36);
  let renamed = 0;
  for (const u of units) {
    await db.unit.update({
      where: { id: u.id },
      data: { active: false, deletedAt: new Date(), code: `_OLD${stamp}_${u.id.slice(0, 6)}` },
    }).then(() => renamed++).catch(() => {/**/});
  }
  summary.deletedUnits = renamed;

  // 1e. Soft-delete Persons demo (con idType=OTHER y idNumber empezando con SEED-)
  const sdp = await db.person.updateMany({
    where: { organizationId: orgId, idType: "OTHER", idNumber: { startsWith: "SEED-" } },
    data: { deletedAt: new Date() },
  });
  summary.deletedPersons = sdp.count;

  // ── 2. CREAR UNIDADES + PROPIETARIOS + OWNERSHIP + DEUDA ─────────────────
  const platformOwner = await db.user.findFirst({
    where: { memberships: { some: { role: "PLATFORM_OWNER" } } },
    select: { id: true },
  });

  for (const p of PROPS) {
    try {
      const code = p.apto; // ej. "B-052"
      const floor = getFloor(code);
      const tower = "B";
      const aliquot = getAliquot(code);

      // Crear unit
      const unit = await db.unit.create({
        data: {
          organizationId: orgId,
          communityId: COMMUNITY_ID,
          code,
          floor,
          tower,
          aliquot: new Prisma.Decimal(aliquot),
          type: code.includes("PH") ? "APARTMENT" : "APARTMENT",
          active: true,
        },
        select: { id: true },
      });
      summary.createdUnits++;

      // Crear person
      const { firstName, lastName } = splitName(p.nombre);
      const idNumber = `XLSX-${code}`;
      const whatsapp = normalizePhone(p.cel);
      const person = await db.person.create({
        data: {
          organizationId: orgId,
          firstName: firstName || code,
          lastName: lastName || "",
          idType: "OTHER",
          idNumber,
          email: p.email ? p.email.toLowerCase() : null,
          whatsapp: whatsapp || null,
          phone: whatsapp || null,
        },
        select: { id: true },
      });
      summary.createdPersons++;

      // Crear ownership
      await db.ownership.create({
        data: {
          unitId: unit.id,
          personId: person.id,
          sharePercent: new Prisma.Decimal("100.00"),
          startDate: new Date("2020-01-01"),
        },
      });
      summary.createdOwnerships++;

      // Crear Invoice de deuda al 31/may (último recibo no pagado)
      if (p.deuda > 0) {
        const rate = 504.91; // BCV aprox mayo 2026
        const usd = new Prisma.Decimal(p.deuda);
        const bss = usd.mul(rate);
        await db.invoice.create({
          data: {
            organizationId: orgId,
            communityId: COMMUNITY_ID,
            unitId: unit.id,
            invoiceNumber: `2026-05-${code}`,
            type: "ALIQUOT",
            periodYear: 2026,
            periodMonth: 5,
            issuedAt: new Date("2026-05-01T12:00:00Z"),
            dueDate: new Date("2026-05-31T12:00:00Z"),
            totalBss: bss,
            totalUsd: usd,
            exchangeRate: new Prisma.Decimal(rate),
            exchangeSource: "MANUAL",
            currencyPrimary: "USD",
            status: "OVERDUE",
            notes: "[reset-castanos-real] Deuda al 31 de mayo según Excel jun/2026",
            items: {
              create: [{
                description: "Recibo de condominio mayo 2026 — pendiente",
                amountBss: bss,
                amountUsd: usd,
                aliquot: new Prisma.Decimal(aliquot),
              }],
            },
          },
        });
        summary.createdInvoices++;
      }
    } catch (e) {
      summary.skipped.push(`${p.apto}: ${(e as Error).message}`);
    }
  }

  // Marker para audit log
  if (platformOwner) {
    await db.auditLog.create({
      data: {
        organizationId: orgId,
        actorId: platformOwner.id,
        action: "INVOICE_VOIDED",
        entityType: "Community",
        entityId: COMMUNITY_ID,
        before: { reason: "reset" },
        after: summary,
      },
    }).catch(() => {/**/});
  }

  return NextResponse.json({ ok: true, community: community.name, summary });
}
