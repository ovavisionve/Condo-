/**
 * Generación de PDFs usando @react-pdf/renderer en el servidor.
 * Devuelve un Buffer listo para enviar como respuesta HTTP o guardar en storage.
 */
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, padding: 40, color: "#111" },
  header: { marginBottom: 20, borderBottomWidth: 2, borderBottomColor: "#1e40af", paddingBottom: 12 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1e40af", marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#6b7280" },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#374151", marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingBottom: 3 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: "35%", color: "#6b7280" },
  value: { width: "65%", fontFamily: "Helvetica-Bold" },
  table: { marginTop: 8 },
  tableHeader: { flexDirection: "row", backgroundColor: "#eff6ff", padding: 6, borderRadius: 2 },
  tableRow: { flexDirection: "row", padding: 6, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  col1: { flex: 1 },
  col2: { width: 80, textAlign: "right" },
  col3: { width: 80, textAlign: "right" },
  col4: { width: 60, textAlign: "center" },
  totalRow: { flexDirection: "row", padding: 6, backgroundColor: "#1e40af", borderRadius: 2, marginTop: 4 },
  totalLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold" },
  totalValue: { width: 80, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 8, color: "#9ca3af", borderTopWidth: 1, borderTopColor: "#e5e7eb", paddingTop: 6 },
  badge: { padding: "2 8", borderRadius: 4, fontSize: 9 },
  agendaItem: { marginBottom: 12, padding: 10, backgroundColor: "#f9fafb", borderRadius: 4 },
  agendaTitle: { fontFamily: "Helvetica-Bold", marginBottom: 3 },
  voteBar: { flexDirection: "row", marginTop: 4, gap: 8 },
  voteFor: { color: "#16a34a" },
  voteAgainst: { color: "#dc2626" },
  voteAbstain: { color: "#d97706" },
  highlight: { backgroundColor: "#eff6ff", padding: 10, borderRadius: 4, marginTop: 10, borderLeftWidth: 3, borderLeftColor: "#1e40af" },
});

// ─── Acta de asamblea ──────────────────────────────────────────────────────

export type AssemblyMinutesData = {
  communityName: string;
  communityAddress?: string;
  assemblyTitle: string;
  scheduledAt: Date;
  location?: string;
  quorumRequired: number;
  quorumReached: boolean | null;
  attendeesCount: number | null;
  totalUnits: number;
  status: string;
  agendaItems: {
    order: number;
    title: string;
    description?: string | null;
    requiresVote: boolean;
    result?: string | null;
    votesFor: number;
    votesAgainst: number;
    votesAbstain: number;
    approved: boolean | null;
  }[];
  boardPresident?: string;
  generatedAt?: Date;
};

function AssemblyMinutesDoc({ data }: { data: AssemblyMinutesData }) {
  const dateStr = data.scheduledAt.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });
  const genStr = (data.generatedAt ?? new Date()).toLocaleDateString("es-VE");

  return React.createElement(Document, { title: `Acta — ${data.assemblyTitle}` },
    React.createElement(Page, { size: "A4", style: styles.page },
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.title }, "ACTA DE ASAMBLEA"),
        React.createElement(Text, { style: styles.subtitle }, data.communityName),
        data.communityAddress && React.createElement(Text, { style: { ...styles.subtitle, fontSize: 9 } }, data.communityAddress),
      ),
      // Info general
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Información de la asamblea"),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Tipo:"), React.createElement(Text, { style: styles.value }, data.assemblyTitle)),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Fecha:"), React.createElement(Text, { style: styles.value }, dateStr)),
        data.location && React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Lugar:"), React.createElement(Text, { style: styles.value }, data.location)),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Quórum requerido:"), React.createElement(Text, { style: styles.value }, `${data.quorumRequired}% de propietarios`)),
        data.attendeesCount != null && React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Asistentes:"),
          React.createElement(Text, { style: styles.value }, `${data.attendeesCount} de ${data.totalUnits} unidades`),
        ),
        React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Quórum alcanzado:"),
          React.createElement(Text, { style: { ...styles.value, color: data.quorumReached ? "#16a34a" : "#dc2626" } },
            data.quorumReached == null ? "No determinado" : data.quorumReached ? "SÍ" : "NO"),
        ),
        data.boardPresident && React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Presidente de junta:"),
          React.createElement(Text, { style: styles.value }, data.boardPresident),
        ),
      ),
      // Orden del día
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Orden del día"),
        ...data.agendaItems.map((item) =>
          React.createElement(View, { key: item.order, style: styles.agendaItem },
            React.createElement(Text, { style: styles.agendaTitle }, `${item.order}. ${item.title}`),
            item.description && React.createElement(Text, { style: { color: "#6b7280", marginBottom: 4 } }, item.description),
            item.requiresVote && React.createElement(View, { style: styles.voteBar },
              React.createElement(Text, { style: styles.voteFor }, `✓ A favor: ${item.votesFor}`),
              React.createElement(Text, { style: styles.voteAgainst }, `✗ En contra: ${item.votesAgainst}`),
              React.createElement(Text, { style: styles.voteAbstain }, `— Abstención: ${item.votesAbstain}`),
              item.approved != null && React.createElement(Text, { style: { color: item.approved ? "#16a34a" : "#dc2626", fontFamily: "Helvetica-Bold" } },
                `→ ${item.approved ? "APROBADO" : "RECHAZADO"}`),
            ),
            item.result && React.createElement(View, { style: styles.highlight },
              React.createElement(Text, { style: { fontFamily: "Helvetica-Bold", marginBottom: 2 } }, "Decisión:"),
              React.createElement(Text, null, item.result),
            ),
          )
        ),
      ),
      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, null, `Documento generado el ${genStr} · ${data.communityName}`),
      ),
    ),
  );
}

export async function generateAssemblyMinutesPdf(data: AssemblyMinutesData): Promise<Buffer> {
  return renderToBuffer(AssemblyMinutesDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Certificado de no-adeudo ─────────────────────────────────────────────

export type NonDebtCertData = {
  communityName: string;
  communityAddress?: string;
  communityRif?: string;
  unitCode: string;
  unitFloor?: number | null;
  unitTower?: string | null;
  ownerName: string;
  ownerIdNumber?: string;
  ownerIdType?: string;
  balanceUsd: string;
  balanceBss: string;
  hasDebt: boolean;
  certDate: Date;
  validUntilDate: Date;
  boardPresident?: string;
  generatedAt?: Date;
};

function NonDebtCertDoc({ data }: { data: NonDebtCertData }) {
  const certDateStr = data.certDate.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });
  const validStr = data.validUntilDate.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });

  return React.createElement(Document, { title: `Solvencia — ${data.unitCode}` },
    React.createElement(Page, { size: "A4", style: styles.page },
      // Header
      React.createElement(View, { style: styles.header },
        React.createElement(Text, { style: styles.title }, "CERTIFICADO DE SOLVENCIA"),
        React.createElement(Text, { style: { ...styles.subtitle, fontFamily: "Helvetica-Bold" } }, data.communityName.toUpperCase()),
        data.communityAddress && React.createElement(Text, { style: { ...styles.subtitle, fontSize: 9 } }, data.communityAddress),
        data.communityRif && React.createElement(Text, { style: { ...styles.subtitle, fontSize: 9 } }, `RIF: ${data.communityRif}`),
      ),
      // Estado
      React.createElement(View, { style: { marginVertical: 20, padding: 16, backgroundColor: data.hasDebt ? "#fef2f2" : "#f0fdf4", borderRadius: 6, borderWidth: 2, borderColor: data.hasDebt ? "#dc2626" : "#16a34a" } },
        React.createElement(Text, { style: { fontSize: 16, fontFamily: "Helvetica-Bold", color: data.hasDebt ? "#dc2626" : "#16a34a", textAlign: "center" } },
          data.hasDebt ? "⚠ UNIDAD CON DEUDA PENDIENTE" : "✓ UNIDAD SOLVENTE"),
        React.createElement(Text, { style: { textAlign: "center", color: "#6b7280", marginTop: 4, fontSize: 9 } },
          data.hasDebt ? `Saldo pendiente: $${data.balanceUsd} USD / Bs ${data.balanceBss}` : "Sin saldo pendiente a la fecha de emisión"),
      ),
      // Datos
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Datos de la unidad"),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Unidad:"), React.createElement(Text, { style: styles.value }, data.unitCode)),
        data.unitFloor != null && React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Piso:"), React.createElement(Text, { style: styles.value }, String(data.unitFloor))),
        data.unitTower && React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Torre:"), React.createElement(Text, { style: styles.value }, data.unitTower)),
      ),
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Propietario"),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Nombre:"), React.createElement(Text, { style: styles.value }, data.ownerName)),
        data.ownerIdNumber && React.createElement(View, { style: styles.row },
          React.createElement(Text, { style: styles.label }, "Cédula/RIF:"),
          React.createElement(Text, { style: styles.value }, `${data.ownerIdType ?? "V"}-${data.ownerIdNumber}`),
        ),
      ),
      React.createElement(View, { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, "Validez del certificado"),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Fecha de emisión:"), React.createElement(Text, { style: styles.value }, certDateStr)),
        React.createElement(View, { style: styles.row }, React.createElement(Text, { style: styles.label }, "Válido hasta:"), React.createElement(Text, { style: styles.value }, validStr)),
      ),
      // Firma
      React.createElement(View, { style: { marginTop: 40 } },
        React.createElement(View, { style: { flexDirection: "row", justifyContent: "space-between" } },
          React.createElement(View, { style: { width: "45%", borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 4 } },
            React.createElement(Text, { style: { textAlign: "center", fontSize: 9 } }, data.boardPresident ?? "Presidente de la Junta"),
            React.createElement(Text, { style: { textAlign: "center", fontSize: 8, color: "#6b7280" } }, "Firma y sello"),
          ),
          React.createElement(View, { style: { width: "45%", borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 4 } },
            React.createElement(Text, { style: { textAlign: "center", fontSize: 9 } }, "Administrador"),
            React.createElement(Text, { style: { textAlign: "center", fontSize: 8, color: "#6b7280" } }, "Firma y sello"),
          ),
        ),
      ),
      // Footer
      React.createElement(View, { style: styles.footer },
        React.createElement(Text, null, `Documento generado el ${(data.generatedAt ?? new Date()).toLocaleDateString("es-VE")} · ${data.communityName}`),
        React.createElement(Text, { style: { marginTop: 2 } }, "Este certificado es válido únicamente durante el período indicado y no exime de obligaciones posteriores."),
      ),
    ),
  );
}

export async function generateNonDebtCertPdf(data: NonDebtCertData): Promise<Buffer> {
  return renderToBuffer(NonDebtCertDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Recibo de Condominio ─────────────────────────────────────────────────────

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// Paleta monocromática formal — sin colores decorativos
const BK   = "#000000";   // negro puro — titulos, lineas gruesas
const DK   = "#1a1a1a";   // texto principal
const MID  = "#555555";   // texto secundario / labels
const LT   = "#888888";   // texto terciario / metadata
const BDR  = "#bbbbbb";   // bordes normales
const BDR2 = "#dddddd";   // bordes suaves / separadores
const ROW  = "#f5f5f5";   // fondo filas alternas (muy sutil)

const inv = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "32 38", color: DK, backgroundColor: "#fff" },

  // ── Membrete / Header ─────────────────────────────────────────────────────
  header: { marginBottom: 12, borderBottomWidth: 2, borderBottomColor: BK, paddingBottom: 10 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: {},
  communityName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 0.3, marginBottom: 3 },
  communityMeta: { fontSize: 8, color: MID, lineHeight: 1.5 },
  headerRight: { alignItems: "flex-end" },
  headerDocLabel: { fontSize: 8, color: MID, textAlign: "right" },
  headerDocNum:   { fontSize: 11, fontFamily: "Helvetica-Bold", color: BK, textAlign: "right", marginTop: 2 },
  thinLine: { height: 1, backgroundColor: BDR, marginTop: 8 },

  // ── Título del documento ──────────────────────────────────────────────────
  docTitleBlock: { marginBottom: 14, paddingTop: 10, borderBottomWidth: 1, borderBottomColor: BDR2, paddingBottom: 10 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 2, marginBottom: 3 },
  docSubtitle: { fontSize: 7.5, color: MID },
  docMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  docMetaItem: { fontSize: 8, color: DK },
  docMetaLabel: { color: LT },

  // ── Cards de dos columnas ─────────────────────────────────────────────────
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  card: { flex: 1, borderWidth: 1, borderColor: BDR },
  cardHeader: { backgroundColor: BK, padding: "4 8" },
  cardHeaderText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 1 },
  cardBody: { padding: "7 8" },
  dataRow: { flexDirection: "row", marginBottom: 4 },
  dataLabel: { width: "44%", color: LT, fontSize: 8 },
  dataValue: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8, color: DK },

  // ── Estado ────────────────────────────────────────────────────────────────
  statusPaid:    { fontSize: 8, fontFamily: "Helvetica-Bold", color: DK },
  statusPartial: { fontSize: 8, fontFamily: "Helvetica-Bold", color: DK },
  statusPending: { fontSize: 8, fontFamily: "Helvetica-Bold", color: DK },

  // ── Sección Gastos Comunes ────────────────────────────────────────────────
  tableSection: { marginBottom: 12 },
  tableSectionTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 1,
                       borderBottomWidth: 1, borderBottomColor: BK, paddingBottom: 4, marginBottom: 0 },
  tableHead: { flexDirection: "row", backgroundColor: BK, padding: "5 7" },
  thDesc: { flex: 1,    color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  thAliq: { width: 60,  color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "center" },
  thUsd:  { width: 68,  color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "right" },
  thBss:  { width: 88,  color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "right" },
  tableRow:    { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2 },
  tableRowAlt: { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  tdDesc: { flex: 1,    color: DK, fontSize: 8 },
  tdAliq: { width: 60,  color: MID, textAlign: "center", fontSize: 8 },
  tdUsd:  { width: 68,  textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 8 },
  tdBss:  { width: 88,  textAlign: "right", color: MID, fontSize: 8 },

  // ── Totales ───────────────────────────────────────────────────────────────
  totalsBox: { marginBottom: 12, borderWidth: 1, borderColor: BDR },
  totalLineRow: { flexDirection: "row", padding: "5 8", borderBottomWidth: 1, borderBottomColor: BDR2 },
  totalLineLabel: { flex: 1, color: DK, fontSize: 8.5 },
  totalLineUsd:   { width: 75, textAlign: "right", fontSize: 8.5 },
  totalLineBss:   { width: 90, textAlign: "right", color: MID, fontSize: 8.5 },
  deductionRow:   { flexDirection: "row", padding: "5 8", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  deductionLabel: { flex: 1, color: MID, fontSize: 8.5 },
  deductionUsd:   { width: 75, textAlign: "right", color: MID, fontSize: 8.5 },
  deductionBss:   { width: 90, textAlign: "right", color: MID, fontSize: 8.5 },
  grandTotalRow:  { flexDirection: "row", padding: "8 8", backgroundColor: BK },
  gtLabel: { flex: 1,  color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtUsd:   { width: 75, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtBss:   { width: 90, textAlign: "right", color: "#cccccc", fontFamily: "Helvetica-Bold", fontSize: 9 },
  cancelledRow:   { flexDirection: "row", padding: "8 8", backgroundColor: DK, borderTopWidth: 2, borderTopColor: BK },
  cancelledLabel: { flex: 1,  color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledUsd:   { width: 75, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledBss:   { width: 90, textAlign: "right", color: "#cccccc", fontFamily: "Helvetica-Bold", fontSize: 9 },

  // ── Tasa BCV ──────────────────────────────────────────────────────────────
  rateBox: { flexDirection: "row", borderWidth: 1, borderColor: BDR,
             padding: "4 8", marginBottom: 10, alignItems: "center", backgroundColor: ROW },
  rateLabel: { color: MID, fontSize: 7.5, flex: 1 },
  rateValue:  { fontFamily: "Helvetica-Bold", color: DK, fontSize: 8 },

  // ── Pagos recibidos ───────────────────────────────────────────────────────
  paymentsSection: { marginBottom: 10 },
  paymentsTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: DK, marginBottom: 4,
                   borderBottomWidth: 1, borderBottomColor: BDR, paddingBottom: 3 },
  paymentRow: { flexDirection: "row", padding: "3.5 0", borderBottomWidth: 1, borderBottomColor: BDR2 },
  paymentLabel: { flex: 1, color: MID, fontSize: 8 },
  paymentAmt: { width: 70, textAlign: "right", color: DK, fontFamily: "Helvetica-Bold", fontSize: 8 },

  // ── Instrucciones de pago ─────────────────────────────────────────────────
  payInfoBox: { borderWidth: 1, borderColor: BDR, marginBottom: 10 },
  payInfoHeader: { backgroundColor: ROW, padding: "4 8", borderBottomWidth: 1, borderBottomColor: BDR },
  payInfoTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 0.5 },
  payInfoBody: { padding: "6 8" },
  payInfoText: { fontSize: 7.5, color: MID, marginBottom: 2.5 },
  payInfoRef:  { fontSize: 7.5, color: DK, fontFamily: "Helvetica-Bold", marginTop: 4 },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: { position: "absolute", bottom: 24, left: 38, right: 38 },
  footerLine1: { height: 2, backgroundColor: BK, marginBottom: 3 },
  footerLine2: { height: 1, backgroundColor: BDR, marginBottom: 5 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerLeft:  { fontSize: 7, color: LT },
  footerRight: { fontSize: 7, color: LT, textAlign: "right" },
  footerLegal: { fontSize: 7, color: MID, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 4 },
});

export type InvoicePdfData = {
  // Comunidad
  communityName: string;
  communityAddress: string;
  communityRif?: string | null;
  communityPhone?: string | null;
  // Factura
  invoiceNumber: string;
  periodYear: number;
  periodMonth: number;    // 1-12
  issuedAt: Date;
  dueDate: Date;
  status: string;
  // Tasa
  exchangeRate: string;  // vesPerUsd
  exchangeSource: string;
  // Unidad
  unitCode: string;
  unitFloor?: number | null;
  unitTower?: string | null;
  // Propietario
  ownerName: string;
  ownerIdType?: string | null;
  ownerIdNumber?: string | null;
  // Ítems de la factura
  items: { description: string; aliquot?: string | null; amountUsd: string; amountBss: string }[];
  /**
   * Items con desglose extendido (estilo Arrayanes): cada ítem expone el monto BASE
   * del gasto (lo que costó al condominio) y la CUOTA (parte que toca a la unidad).
   * Se agrupan por sección (común / torre / individual). Opcional.
   */
  sections?: {
    title: string;            // ej: "GASTOS COMUNES" o "GASTOS TORRE A"
    aliquotPercent?: string;  // ej: "0.5319"
    baseTotalBss?: string;    // monto total de la sección antes del prorrateo
    items: {
      description: string;
      baseBss: string;        // monto total del gasto en Bs (lo que costó)
      cuotaUsd: string;       // parte que le toca a la unidad en USD
      cuotaBss: string;       // parte en Bs
    }[];
    subtotalUsd: string;
    subtotalBss: string;
  }[];
  /**
   * Fondo de reserva acumulado por la unidad (cliente Arrayanes lo muestra en su recibo).
   * Si está presente, el PDF agrega una sección al final.
   */
  reserveFund?: {
    previousBalanceUsd: string;  // saldo acumulado anterior
    previousBalanceBss: string;
    contributionUsd: string;     // aporte del mes
    contributionBss: string;
    period: string;              // ej: "04/2026"
    totalUsd: string;            // saldo nuevo
    totalBss: string;
  };
  // Totales
  totalUsd: string;
  totalBss: string;
  paidUsd: string;
  paidBss: string;
  // Pagos aplicados a esta factura
  paymentsApplied?: {
    paidAt: Date;
    method: string;
    amountUsd: string;
    amountBss: string;
    reference?: string | null;
  }[];
  // Cuentas bancarias para instrucciones de pago
  bankAccounts?: {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    accountType: string;
    currency: string;
    notes?: string | null;
  }[];
};

const METHOD_SHORT: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD", TRANSFER_BSS: "Trans. Bs",
  TRANSFER_USD: "Trans. USD", ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Cripto", CHECK: "Cheque", OTHER: "Otro",
};

function dr(label: string, value: string) {
  return React.createElement(View, { style: inv.dataRow },
    React.createElement(Text, { style: inv.dataLabel }, label),
    React.createElement(Text, { style: inv.dataValue }, value),
  );
}

function InvoiceDoc({ data }: { data: InvoicePdfData }) {
  const mes = MESES_ES[(data.periodMonth - 1)] ?? "";
  const periodo = `${mes} ${data.periodYear}`;
  const pendingUsd = Math.max(0, Number(data.totalUsd) - Number(data.paidUsd));
  const pendingBss = Math.max(0, Number(data.totalBss) - Number(data.paidBss));
  const isPaid    = pendingUsd < 0.005;
  const isPartial = !isPaid && Number(data.paidUsd) > 0.005;
  const issuedStr = data.issuedAt.toLocaleDateString("es-VE");
  const dueStr    = data.dueDate.toLocaleDateString("es-VE");
  const idStr = data.ownerIdType && data.ownerIdNumber
    ? `${data.ownerIdType}-${data.ownerIdNumber}` : "";
  const genStr = new Date().toLocaleDateString("es-VE");

  const fmtUsd = (v: string | number) => `$${Number(v).toFixed(2)}`;
  const fmtBss = (v: string | number) =>
    `Bs ${Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const statusLabel = isPaid ? "CANCELADO" : isPartial ? "PAGO PARCIAL" : "PENDIENTE DE PAGO";

  return React.createElement(Document, { title: `Recibo de Condominio ${data.invoiceNumber}` },
    React.createElement(Page, { size: "A4", style: inv.page },

      // ── Membrete ───────────────────────────────────────────────
      React.createElement(View, { style: inv.header },
        React.createElement(View, { style: inv.headerTop },
          React.createElement(View, { style: inv.headerLeft },
            React.createElement(Text, { style: inv.communityName }, data.communityName.toUpperCase()),
            React.createElement(Text, { style: inv.communityMeta },
              "JUNTA DE CONDOMINIO" + (data.communityRif ? "   RIF: " + data.communityRif : "")),
            React.createElement(Text, { style: { ...inv.communityMeta, marginTop: 1 } },
              [data.communityAddress, data.communityPhone].filter(Boolean).join("   ")),
          ),
          React.createElement(View, { style: inv.headerRight },
            React.createElement(Text, { style: inv.headerDocLabel }, "Número de Recibo"),
            React.createElement(Text, { style: inv.headerDocNum }, data.invoiceNumber),
          ),
        ),
        React.createElement(View, { style: inv.thinLine }),
      ),

      // ── Título del documento ───────────────────────────────────
      React.createElement(View, { style: inv.docTitleBlock },
        React.createElement(Text, { style: inv.docTitle }, "RECIBO DE CONDOMINIO"),
        React.createElement(Text, { style: inv.docSubtitle },
          "Documento con fuerza ejecutiva — Art. 14 de la Ley de Propiedad Horizontal"),
        React.createElement(View, { style: inv.docMeta },
          React.createElement(Text, { style: inv.docMetaItem },
            React.createElement(Text, { style: inv.docMetaLabel }, "Período: "),
            periodo),
          React.createElement(Text, { style: inv.docMetaItem },
            React.createElement(Text, { style: inv.docMetaLabel }, "Emisión: "),
            issuedStr),
          React.createElement(Text, { style: inv.docMetaItem },
            React.createElement(Text, { style: inv.docMetaLabel }, "Vencimiento: "),
            dueStr),
          React.createElement(Text, { style: inv.docMetaItem },
            React.createElement(Text, { style: inv.docMetaLabel }, "Estado: "),
            statusLabel),
        ),
      ),

      // ── Dos columnas: datos del recibo | unidad y propietario ──
      React.createElement(View, { style: inv.twoCol },
        React.createElement(View, { style: inv.card },
          React.createElement(View, { style: inv.cardHeader },
            React.createElement(Text, { style: inv.cardHeaderText }, "DATOS DEL RECIBO"),
          ),
          React.createElement(View, { style: inv.cardBody },
            dr("N° Recibo:", data.invoiceNumber),
            dr("Período:", periodo),
            dr("Fecha de emisión:", issuedStr),
            dr("Fecha de vencimiento:", dueStr),
            dr("Estado:", statusLabel),
          ),
        ),
        React.createElement(View, { style: inv.card },
          React.createElement(View, { style: inv.cardHeader },
            React.createElement(Text, { style: inv.cardHeaderText }, "UNIDAD Y PROPIETARIO"),
          ),
          React.createElement(View, { style: inv.cardBody },
            dr("Unidad:", data.unitCode),
            data.unitTower ? dr("Torre:", data.unitTower) : null,
            data.unitFloor != null ? dr("Piso:", String(data.unitFloor)) : null,
            dr("Propietario:", data.ownerName),
            idStr ? dr("Cédula / RIF:", idStr) : null,
          ),
        ),
      ),

      // ── Items: layout Arrayanes (sections con base/cuota) o legacy ──────────
      data.sections && data.sections.length > 0
        ? React.createElement(View, {},
            ...data.sections.map((sec, sIdx) =>
              React.createElement(View, { key: sIdx, style: inv.tableSection },
                React.createElement(Text, { style: inv.tableSectionTitle }, sec.title),
                React.createElement(View, { style: inv.tableHead },
                  React.createElement(Text, { style: inv.thDesc }, "Concepto / Descripción"),
                  React.createElement(Text, { style: inv.thAliq }, "Total Bs"),
                  React.createElement(Text, { style: inv.thUsd }, "Cuota USD"),
                  React.createElement(Text, { style: inv.thBss }, "Cuota Bs"),
                ),
                ...sec.items.map((it, i) =>
                  React.createElement(View, { key: i, style: i % 2 === 0 ? inv.tableRow : inv.tableRowAlt },
                    React.createElement(Text, { style: inv.tdDesc }, it.description),
                    React.createElement(Text, { style: inv.tdAliq }, fmtBss(it.baseBss)),
                    React.createElement(Text, { style: inv.tdUsd }, fmtUsd(it.cuotaUsd)),
                    React.createElement(Text, { style: inv.tdBss }, fmtBss(it.cuotaBss)),
                  ),
                ),
                // Subtotal de la sección con porcentaje aplicado
                React.createElement(View, { style: inv.totalLineRow },
                  React.createElement(Text, { style: inv.totalLineLabel },
                    `Total ${sec.title}${sec.aliquotPercent ? ` (${Number(sec.aliquotPercent).toFixed(4)}%${sec.baseTotalBss ? ` de Bs ${fmtBss(sec.baseTotalBss)}` : ""})` : ""}`,
                  ),
                  React.createElement(Text, { style: inv.totalLineUsd }, fmtUsd(sec.subtotalUsd)),
                  React.createElement(Text, { style: inv.totalLineBss }, fmtBss(sec.subtotalBss)),
                ),
              ),
            ),
          )
        : React.createElement(View, { style: inv.tableSection },
            React.createElement(Text, { style: inv.tableSectionTitle }, "GASTOS COMUNES"),
            React.createElement(View, { style: inv.tableHead },
              React.createElement(Text, { style: inv.thDesc }, "Concepto / Descripción"),
              React.createElement(Text, { style: inv.thAliq }, "Cuota Part."),
              React.createElement(Text, { style: inv.thUsd }, "USD"),
              React.createElement(Text, { style: inv.thBss }, "Bs.S"),
            ),
            ...data.items.map((item, i) =>
              React.createElement(View, { key: i, style: i % 2 === 0 ? inv.tableRow : inv.tableRowAlt },
                React.createElement(Text, { style: inv.tdDesc }, item.description),
                React.createElement(Text, { style: inv.tdAliq },
                  item.aliquot ? `${Number(item.aliquot).toFixed(4)}%` : "—"),
                React.createElement(Text, { style: inv.tdUsd }, fmtUsd(item.amountUsd)),
                React.createElement(Text, { style: inv.tdBss }, fmtBss(item.amountBss)),
              ),
            ),
          ),

      // ── Fondo de Reserva (estilo Arrayanes) ─────────────────────
      data.reserveFund && React.createElement(View, { style: inv.tableSection },
        React.createElement(Text, { style: inv.tableSectionTitle }, "FONDO DE RESERVA"),
        React.createElement(View, { style: inv.tableHead },
          React.createElement(Text, { style: inv.thDesc }, "Concepto"),
          React.createElement(Text, { style: inv.thAliq }, ""),
          React.createElement(Text, { style: inv.thUsd }, "USD"),
          React.createElement(Text, { style: inv.thBss }, "Bs.S"),
        ),
        React.createElement(View, { style: inv.tableRow },
          React.createElement(Text, { style: inv.tdDesc }, "Saldo Anterior"),
          React.createElement(Text, { style: inv.tdAliq }, ""),
          React.createElement(Text, { style: inv.tdUsd }, fmtUsd(data.reserveFund.previousBalanceUsd)),
          React.createElement(Text, { style: inv.tdBss }, fmtBss(data.reserveFund.previousBalanceBss)),
        ),
        React.createElement(View, { style: inv.tableRowAlt },
          React.createElement(Text, { style: inv.tdDesc }, `Aporte ${data.reserveFund.period}`),
          React.createElement(Text, { style: inv.tdAliq }, ""),
          React.createElement(Text, { style: inv.tdUsd }, fmtUsd(data.reserveFund.contributionUsd)),
          React.createElement(Text, { style: inv.tdBss }, fmtBss(data.reserveFund.contributionBss)),
        ),
        React.createElement(View, { style: inv.totalLineRow },
          React.createElement(Text, { style: inv.totalLineLabel }, "Total Fondo de Reserva acumulado"),
          React.createElement(Text, { style: inv.totalLineUsd }, fmtUsd(data.reserveFund.totalUsd)),
          React.createElement(Text, { style: inv.totalLineBss }, fmtBss(data.reserveFund.totalBss)),
        ),
      ),

      // ── Totales ─────────────────────────────────────────────────
      React.createElement(View, { style: inv.totalsBox },
        React.createElement(View, { style: inv.totalLineRow },
          React.createElement(Text, { style: inv.totalLineLabel }, "Total de Gastos Comunes"),
          React.createElement(Text, { style: inv.totalLineUsd }, fmtUsd(data.totalUsd)),
          React.createElement(Text, { style: inv.totalLineBss }, fmtBss(data.totalBss)),
        ),
        Number(data.paidUsd) > 0.005 && React.createElement(View, { style: inv.deductionRow },
          React.createElement(Text, { style: inv.deductionLabel }, "(–) Abonos recibidos"),
          React.createElement(Text, { style: inv.deductionUsd }, `– ${fmtUsd(data.paidUsd)}`),
          React.createElement(Text, { style: inv.deductionBss }, `– ${fmtBss(data.paidBss)}`),
        ),
        isPaid
          ? React.createElement(View, { style: inv.cancelledRow },
              React.createElement(Text, { style: inv.cancelledLabel }, "SALDO TOTAL: CANCELADO"),
              React.createElement(Text, { style: inv.cancelledUsd }, "$0.00"),
              React.createElement(Text, { style: inv.cancelledBss }, "Bs 0,00"),
            )
          : React.createElement(View, { style: inv.grandTotalRow },
              React.createElement(Text, { style: inv.gtLabel }, "TOTAL A PAGAR"),
              React.createElement(Text, { style: inv.gtUsd }, fmtUsd(pendingUsd)),
              React.createElement(Text, { style: inv.gtBss }, fmtBss(pendingBss)),
            ),
      ),

      // ── Tasa BCV ─────────────────────────────────────────────────
      React.createElement(View, { style: inv.rateBox },
        React.createElement(Text, { style: inv.rateLabel },
          `Tasa BCV aplicada: ${Number(data.exchangeRate).toFixed(4)} Bs/$ (${data.exchangeSource})` +
          `   —   El saldo en USD es fijo. El equivalente en Bs puede variar según la tasa vigente.`),
      ),

      // ── Pagos recibidos en este recibo ────────────────────────
      data.paymentsApplied && data.paymentsApplied.length > 0 &&
        React.createElement(View, { style: inv.paymentsSection },
          React.createElement(Text, { style: inv.paymentsTitle }, "ABONOS REGISTRADOS EN ESTE RECIBO"),
          ...data.paymentsApplied.map((p, i) =>
            React.createElement(View, { key: i, style: inv.paymentRow },
              React.createElement(Text, { style: inv.paymentLabel },
                `${p.paidAt.toLocaleDateString("es-VE")}   ${METHOD_SHORT[p.method] ?? p.method}` +
                (p.reference ? `   Ref: ${p.reference}` : "")),
              React.createElement(Text, { style: inv.paymentAmt }, fmtUsd(p.amountUsd)),
            )
          ),
        ),

      // ── Instrucciones de pago ─────────────────────────────────
      !isPaid && React.createElement(View, { style: inv.payInfoBox },
        React.createElement(View, { style: inv.payInfoHeader },
          React.createElement(Text, { style: inv.payInfoTitle }, "INSTRUCCIONES DE PAGO"),
        ),
        React.createElement(View, { style: inv.payInfoBody },
          React.createElement(Text, { style: inv.payInfoText },
            "Métodos aceptados: Transferencia bancaria  ·  Pago Móvil  ·  Zelle  ·  Efectivo USD  ·  Efectivo Bs"),
          ...(data.bankAccounts && data.bankAccounts.length > 0
            ? data.bankAccounts.map((acc, i) =>
                React.createElement(Text, { key: i, style: inv.payInfoText },
                  [
                    `${acc.bankName}  ${acc.accountType}`,
                    acc.accountNumber !== "-" ? `${acc.currency}: ${acc.accountNumber}` : null,
                    `Titular: ${acc.accountHolder}`,
                    acc.notes ?? null,
                  ].filter(Boolean).join("   "))
              )
            : [React.createElement(Text, { style: inv.payInfoText },
                "Contacte a la Junta de Condominio para obtener los datos bancarios.")]),
          React.createElement(Text, { style: inv.payInfoRef },
            `Incluir el N° de recibo ${data.invoiceNumber} en el concepto de la transferencia.`),
        ),
      ),

      // ── Footer ────────────────────────────────────────────────
      React.createElement(View, { style: inv.footer },
        React.createElement(View, { style: inv.footerLine2 }),
        React.createElement(View, { style: inv.footerLine1 }),
        React.createElement(View, { style: inv.footerRow },
          React.createElement(Text, { style: inv.footerLeft },
            `Emitido el ${genStr}   ${data.communityName}`),
          React.createElement(Text, { style: inv.footerRight },
            "Los montos en Bs.S se calculan con la tasa BCV del período de emisión"),
        ),
        React.createElement(Text, { style: inv.footerLegal },
          "Titulo Ejecutivo — Articulo 14, Ley de Propiedad Horizontal de la Republica Bolivariana de Venezuela"),
      ),
    ),
  );
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(InvoiceDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Carta de cobro extrajudicial (Art. 14 LPH) ───────────────────────────────

export type LegalNoticePdfData = {
  // Comunidad / Junta
  communityName: string;
  communityAddress: string;
  communityRif?: string | null;
  communityCity?: string | null;
  communityPhone?: string | null;
  // Documento
  noticeNumber: string;
  noticeDate: Date;
  reason: "OVERDUE_90" | "OVERDUE_180" | "OTHER";
  customMessage?: string | null;
  // Destinatario
  ownerName: string;
  ownerIdType?: string | null;
  ownerIdNumber?: string | null;
  unitCode: string;
  unitTower?: string | null;
  unitFloor?: number | null;
  // Facturas adeudadas
  invoices: {
    invoiceNumber: string;
    periodLabel: string;     // "Abril 2025"
    dueDate: Date;
    daysOverdue: number;
    pendingUsd: string;
    pendingBss: string;
  }[];
  totalPendingUsd: string;
  totalPendingBss: string;
  exchangeRate: string;
  exchangeSource: string;
  // Plazo legal
  graceDays: number;          // ej. 15
  signerName?: string | null; // Administrador / Presidente Junta
  signerRole?: string | null;
};

const REASON_LABEL: Record<string, string> = {
  OVERDUE_90:  "MORA SUPERIOR A NOVENTA (90) DÍAS",
  OVERDUE_180: "MORA SUPERIOR A CIENTO OCHENTA (180) DÍAS",
  OTHER:       "INCUMPLIMIENTO DE OBLIGACIONES CONDOMINIALES",
};

const ln = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, padding: "40 44", color: DK, backgroundColor: "#fff", lineHeight: 1.45 },

  // Header
  header: { marginBottom: 16, borderBottomWidth: 2, borderBottomColor: BK, paddingBottom: 10 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  communityName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 0.4, marginBottom: 3 },
  communityMeta: { fontSize: 8.5, color: MID, lineHeight: 1.5 },
  docId:   { fontSize: 11, fontFamily: "Helvetica-Bold", color: BK, textAlign: "right" },
  docIdLabel: { fontSize: 8, color: MID, textAlign: "right" },

  // Title
  titleBlock: { marginBottom: 14, alignItems: "center" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 2.5, textAlign: "center" },
  subtitle: { fontSize: 9, color: MID, marginTop: 4, textAlign: "center", letterSpacing: 0.5 },

  // Lugar + fecha
  placeDate: { fontSize: 10, color: DK, marginBottom: 12, textAlign: "right" },

  // Destinatario
  recipient: { marginBottom: 14, borderLeftWidth: 3, borderLeftColor: BK, paddingLeft: 10 },
  recipientLabel: { fontSize: 8, color: LT, letterSpacing: 1, marginBottom: 3 },
  recipientName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: BK },
  recipientLine: { fontSize: 9.5, color: DK, marginTop: 1 },

  // Cuerpo
  body: { marginBottom: 12 },
  paragraph: { fontSize: 10, color: DK, marginBottom: 8, textAlign: "justify", lineHeight: 1.55 },
  paragraphBold: { fontFamily: "Helvetica-Bold" },

  // Cita legal
  legalQuote: { backgroundColor: ROW, padding: "9 12", borderLeftWidth: 2, borderLeftColor: BK,
                marginBottom: 10, marginTop: 4 },
  legalQuoteHeader: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: BK, marginBottom: 4, letterSpacing: 0.5 },
  legalQuoteText: { fontSize: 9.5, color: DK, fontStyle: "italic", textAlign: "justify", lineHeight: 1.5 },

  // Tabla deuda
  tableTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: BK, marginTop: 8, marginBottom: 4, letterSpacing: 0.5 },
  tableHead: { flexDirection: "row", backgroundColor: BK, padding: "5 6" },
  th: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  thNum:    { width: 90, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  thPer:    { width: 72, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  thDue:    { width: 60, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "center" },
  thDays:   { width: 40, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "center" },
  thUsd:    { flex: 1,   color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  thBss:    { width: 90, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  row:    { flexDirection: "row", padding: "4 6", borderBottomWidth: 1, borderBottomColor: BDR2 },
  rowAlt: { flexDirection: "row", padding: "4 6", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  tdNum:  { width: 90, fontSize: 8.5, color: DK, fontFamily: "Helvetica-Bold" },
  tdPer:  { width: 72, fontSize: 8.5, color: DK },
  tdDue:  { width: 60, fontSize: 8.5, color: MID, textAlign: "center" },
  tdDays: { width: 40, fontSize: 8.5, color: DK, textAlign: "center", fontFamily: "Helvetica-Bold" },
  tdUsd:  { flex: 1,   fontSize: 8.5, color: DK, textAlign: "right", fontFamily: "Helvetica-Bold" },
  tdBss:  { width: 90, fontSize: 8.5, color: MID, textAlign: "right" },

  totalRow: { flexDirection: "row", padding: "6 6", backgroundColor: BK, marginTop: 2 },
  totalLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  totalUsd:   { width: 90, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10, textAlign: "right" },
  totalBss:   { width: 90, color: "#cccccc", fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right" },

  // Plazo / advertencia
  warningBox: { borderWidth: 1, borderColor: BK, padding: "10 12", marginTop: 12, marginBottom: 14 },
  warningTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BK, marginBottom: 4, letterSpacing: 0.5 },
  warningText: { fontSize: 9.5, color: DK, textAlign: "justify", lineHeight: 1.5 },

  // Firma
  signatureBlock: { marginTop: 28, alignItems: "center" },
  signLine: { borderTopWidth: 1, borderTopColor: BK, width: 240, marginBottom: 4 },
  signName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BK, textAlign: "center" },
  signRole: { fontSize: 9, color: MID, textAlign: "center" },
  signOrg:  { fontSize: 9, color: MID, textAlign: "center", marginTop: 1 },

  footer: { position: "absolute", bottom: 28, left: 44, right: 44 },
  footerLine: { height: 1, backgroundColor: BDR, marginBottom: 4 },
  footerText: { fontSize: 7.5, color: LT, textAlign: "center" },
  footerLegal: { fontSize: 7.5, color: MID, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
});

function LegalNoticeDoc({ data }: { data: LegalNoticePdfData }) {
  const fmtUsd = (v: string | number) => `$${Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtBss = (v: string | number) =>
    `Bs ${Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateLong = data.noticeDate.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });
  const idStr = data.ownerIdType && data.ownerIdNumber
    ? `${data.ownerIdType}-${data.ownerIdNumber}` : "";
  const unitLine = [
    `Unidad ${data.unitCode}`,
    data.unitTower ? `Torre ${data.unitTower}` : null,
    data.unitFloor != null ? `Piso ${data.unitFloor}` : null,
  ].filter(Boolean).join(" · ");
  const place = data.communityCity ?? "Venezuela";

  return React.createElement(Document, { title: `Aviso de Cobro Extrajudicial — ${data.noticeNumber}` },
    React.createElement(Page, { size: "A4", style: ln.page },

      // Header
      React.createElement(View, { style: ln.header },
        React.createElement(View, { style: ln.headerTop },
          React.createElement(View, {},
            React.createElement(Text, { style: ln.communityName }, data.communityName.toUpperCase()),
            React.createElement(Text, { style: ln.communityMeta },
              "JUNTA DE CONDOMINIO" + (data.communityRif ? "   RIF: " + data.communityRif : "")),
            React.createElement(Text, { style: { ...ln.communityMeta, marginTop: 1 } },
              [data.communityAddress, data.communityPhone].filter(Boolean).join("   ")),
          ),
          React.createElement(View, {},
            React.createElement(Text, { style: ln.docIdLabel }, "Aviso N°"),
            React.createElement(Text, { style: ln.docId }, data.noticeNumber),
          ),
        ),
      ),

      // Título
      React.createElement(View, { style: ln.titleBlock },
        React.createElement(Text, { style: ln.title }, "AVISO DE COBRO EXTRAJUDICIAL"),
        React.createElement(Text, { style: ln.subtitle }, REASON_LABEL[data.reason] ?? REASON_LABEL.OTHER),
      ),

      // Lugar y fecha
      React.createElement(Text, { style: ln.placeDate },
        `${place}, ${dateLong}`),

      // Destinatario
      React.createElement(View, { style: ln.recipient },
        React.createElement(Text, { style: ln.recipientLabel }, "DIRIGIDO A:"),
        React.createElement(Text, { style: ln.recipientName },
          `Ciudadano(a): ${data.ownerName.toUpperCase()}`),
        idStr ? React.createElement(Text, { style: ln.recipientLine }, `Cédula / RIF: ${idStr}`) : null,
        React.createElement(Text, { style: ln.recipientLine }, `Propietario / Ocupante de: ${unitLine}`),
        React.createElement(Text, { style: ln.recipientLine },
          data.communityName + (data.communityAddress ? ` — ${data.communityAddress}` : "")),
      ),

      // Cuerpo: introducción
      React.createElement(View, { style: ln.body },
        React.createElement(Text, { style: ln.paragraph },
          "Por medio de la presente, la Junta de Condominio del inmueble identificado supra, en ejercicio de las atribuciones que le confiere la ",
          React.createElement(Text, { style: ln.paragraphBold }, "Ley de Propiedad Horizontal de la República Bolivariana de Venezuela"),
          ", procede a notificar formalmente a usted del estado de mora en que se encuentra respecto al pago de las cuotas ordinarias y/o extraordinarias de condominio correspondientes a la unidad de su propiedad u ocupación.",
        ),

        // Cita Art. 14 LPH
        React.createElement(View, { style: ln.legalQuote },
          React.createElement(Text, { style: ln.legalQuoteHeader }, "ARTÍCULO 14 — LEY DE PROPIEDAD HORIZONTAL"),
          React.createElement(Text, { style: ln.legalQuoteText },
            "\"La obligación del propietario de un apartamento o local por concepto de pago de las cuotas que le correspondan en los gastos comunes constituye un crédito privilegiado del condominio, y los documentos otorgados por el administrador o por la junta de condominio en los que conste dicha obligación, tendrán fuerza ejecutiva y aparejarán ejecución por la vía del procedimiento ejecutivo, sin perjuicio del derecho que tienen los propietarios a impugnar los gastos comunes en juicio ordinario.\"",
          ),
        ),

        React.createElement(Text, { style: ln.paragraph },
          "En consecuencia, los recibos de condominio emitidos a su nombre, debidamente identificados en el presente documento, constituyen ",
          React.createElement(Text, { style: ln.paragraphBold }, "títulos ejecutivos"),
          " a tenor de la norma citada, y su falta de pago habilita a esta Junta de Condominio para acudir a la vía judicial ejecutiva sin necesidad de juicio previo de cognición.",
        ),

        data.customMessage && data.customMessage.trim().length > 0
          ? React.createElement(Text, { style: ln.paragraph }, data.customMessage.trim())
          : null,
      ),

      // Tabla de facturas adeudadas
      React.createElement(Text, { style: ln.tableTitle },
        "DETALLE DE RECIBOS PENDIENTES DE PAGO"),
      React.createElement(View, { style: ln.tableHead },
        React.createElement(Text, { style: ln.thNum }, "N° Recibo"),
        React.createElement(Text, { style: ln.thPer }, "Período"),
        React.createElement(Text, { style: ln.thDue }, "Vence"),
        React.createElement(Text, { style: ln.thDays }, "Mora"),
        React.createElement(Text, { style: ln.thUsd }, "Pendiente USD"),
        React.createElement(Text, { style: ln.thBss }, "Pendiente Bs"),
      ),
      ...data.invoices.map((inv, i) =>
        React.createElement(View, { key: i, style: i % 2 === 0 ? ln.row : ln.rowAlt },
          React.createElement(Text, { style: ln.tdNum }, inv.invoiceNumber),
          React.createElement(Text, { style: ln.tdPer }, inv.periodLabel),
          React.createElement(Text, { style: ln.tdDue }, inv.dueDate.toLocaleDateString("es-VE")),
          React.createElement(Text, { style: ln.tdDays }, `${inv.daysOverdue} d`),
          React.createElement(Text, { style: ln.tdUsd }, fmtUsd(inv.pendingUsd)),
          React.createElement(Text, { style: ln.tdBss }, fmtBss(inv.pendingBss)),
        ),
      ),
      React.createElement(View, { style: ln.totalRow },
        React.createElement(Text, { style: ln.totalLabel }, "TOTAL ADEUDADO"),
        React.createElement(Text, { style: ln.totalUsd }, fmtUsd(data.totalPendingUsd)),
        React.createElement(Text, { style: ln.totalBss }, fmtBss(data.totalPendingBss)),
      ),
      React.createElement(Text, { style: { fontSize: 8, color: MID, marginTop: 4, textAlign: "right" } },
        `Tasa BCV aplicada: ${Number(data.exchangeRate).toFixed(4)} Bs/$ (${data.exchangeSource})`),

      // Plazo y advertencia
      React.createElement(View, { style: ln.warningBox },
        React.createElement(Text, { style: ln.warningTitle },
          `PLAZO PARA EL PAGO: ${data.graceDays} DÍAS CALENDARIO`),
        React.createElement(Text, { style: ln.warningText },
          `Se le concede un plazo improrrogable de ${data.graceDays} (${data.graceDays === 15 ? "QUINCE" : data.graceDays}) días calendario, contados a partir de la recepción de la presente comunicación, para que proceda a cancelar la totalidad de la deuda señalada o a celebrar un convenio de pago formal con esta Administración. `,
          React.createElement(Text, { style: ln.paragraphBold },
            "Vencido dicho plazo sin que se haya verificado el pago o el acuerdo, esta Junta de Condominio procederá a ejercer las acciones judiciales que en derecho correspondan, "),
          "incluyendo demanda por la vía ejecutiva al amparo del artículo 14 de la Ley de Propiedad Horizontal, con la consiguiente generación de costas y costos procesales a su cargo.",
        ),
      ),

      // Firma
      React.createElement(View, { style: ln.signatureBlock },
        React.createElement(View, { style: ln.signLine }),
        React.createElement(Text, { style: ln.signName },
          (data.signerName ?? "Administración").toUpperCase()),
        React.createElement(Text, { style: ln.signRole },
          data.signerRole ?? "Administrador / Junta de Condominio"),
        React.createElement(Text, { style: ln.signOrg }, data.communityName),
      ),

      // Footer
      React.createElement(View, { style: ln.footer },
        React.createElement(View, { style: ln.footerLine }),
        React.createElement(Text, { style: ln.footerText },
          `Documento emitido el ${dateLong}   ·   ${data.communityName}`),
        React.createElement(Text, { style: ln.footerLegal },
          "AVISO DE COBRO EXTRAJUDICIAL · ARTÍCULO 14 LEY DE PROPIEDAD HORIZONTAL · REPÚBLICA BOLIVARIANA DE VENEZUELA"),
      ),
    ),
  );
}

export async function generateLegalNoticePdf(data: LegalNoticePdfData): Promise<Buffer> {
  return renderToBuffer(LegalNoticeDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Bauche / Comprobante de pago ─────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs", CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Transferencia Bancaria (Bs)", TRANSFER_USD: "Transferencia Bancaria (USD)",
  ZELLE: "Zelle", PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Criptomoneda", CHECK: "Cheque", OTHER: "Otro",
};

export type PaymentVoucherData = {
  communityName: string;
  communityAddress?: string;
  communityRif?: string;
  communityPhone?: string;
  communityEmail?: string;
  paymentId: string;
  unitCode: string;
  personName: string;
  personId?: string;
  amountUsd: string;
  amountBss: string;
  exchangeRate: string;
  method: string;
  reference?: string;
  paidAt: Date;
  invoices: { number: string; period: string; amountUsd: string }[];
  /** Saldo a favor: monto no aplicado a facturas que queda como anticipo. */
  creditUsd?: string;
  creditBss?: string;
};

const vc = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "32 38", color: DK, backgroundColor: "#fff" },

  // ── Membrete ───────────────────────────────────────────────────────────
  header: { marginBottom: 12, borderBottomWidth: 2, borderBottomColor: BK, paddingBottom: 10 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  communityName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 0.3, marginBottom: 3 },
  communityMeta: { fontSize: 8, color: MID, lineHeight: 1.5 },
  headerRight: { alignItems: "flex-end" },
  headerDocLabel: { fontSize: 8, color: MID, textAlign: "right" },
  headerDocNum:   { fontSize: 11, fontFamily: "Helvetica-Bold", color: BK, textAlign: "right", marginTop: 2 },
  thinLine: { height: 1, backgroundColor: BDR, marginTop: 8 },

  // ── Título + banda de referencia ────────────────────────────────────────
  titleBlock: { borderBottomWidth: 1, borderBottomColor: BDR2, paddingBottom: 10, marginBottom: 14 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 2, marginBottom: 3 },
  docSubtitle: { fontSize: 7.5, color: MID },
  refRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  refItem: { fontSize: 8, color: DK },
  refLabel: { color: LT },

  // ── Caja monto principal ────────────────────────────────────────────────
  amountOuter: { borderWidth: 1, borderColor: BDR, marginBottom: 14 },
  amountHeader: { backgroundColor: BK, padding: "5 10", borderBottomWidth: 0 },
  amountHeaderText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 1 },
  amountBody: { flexDirection: "row", padding: "14 14", justifyContent: "space-between", alignItems: "center" },
  amountLeft: {},
  amountLabelText: { fontSize: 8, color: MID, marginBottom: 3 },
  amountUsdText: { fontSize: 28, fontFamily: "Helvetica-Bold", color: BK, marginBottom: 4 },
  amountBssText: { fontSize: 10, color: MID },
  amountRateText: { fontSize: 7.5, color: LT, marginTop: 3 },
  stampBox: { borderWidth: 2, borderColor: BK, padding: "10 16", alignItems: "center" },
  stampCheckmark: { fontSize: 20, color: BK, textAlign: "center", marginBottom: 2 },
  stampVerified: { fontSize: 12, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 2 },
  stampDate: { fontSize: 7.5, color: MID, marginTop: 4, textAlign: "center" },

  // ── Cards dos columnas ──────────────────────────────────────────────────
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 14 },
  card: { flex: 1, borderWidth: 1, borderColor: BDR },
  cardHeader: { backgroundColor: BK, padding: "4 8" },
  cardHeaderText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 1 },
  cardBody: { padding: "7 8" },
  vRow: { flexDirection: "row", marginBottom: 4 },
  vLbl: { width: "42%", color: LT, fontSize: 8 },
  vVal: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8, color: DK },

  // ── Tabla recibos aplicados ─────────────────────────────────────────────
  invoiceSection: { marginBottom: 14 },
  invoiceSectionTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 1,
                          borderBottomWidth: 1, borderBottomColor: BK, paddingBottom: 4, marginBottom: 0 },
  invoiceTableHead: { flexDirection: "row", backgroundColor: BK, padding: "5 7" },
  invoiceThDesc: { flex: 1,   color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  invoiceThPeriod: { width: 72, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "center" },
  invoiceThAmt: { width: 82, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "right" },
  invoiceRow: { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2 },
  invoiceRowAlt: { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  invoiceTdDesc: { flex: 1,   fontSize: 8, color: DK },
  invoiceTdPeriod: { width: 72, fontSize: 8, textAlign: "center", color: MID },
  invoiceTdAmt: { width: 82, fontSize: 8, textAlign: "right", fontFamily: "Helvetica-Bold", color: DK },

  // ── Anticipo notice ─────────────────────────────────────────────────────
  anticipoBox: { borderWidth: 1, borderColor: BDR, backgroundColor: ROW, padding: "8 10", marginBottom: 14 },
  anticipoText: { fontSize: 8.5, color: MID },

  // ── "Aplicado a:" resumen rapido ───────────────────────────────────────
  appliedToBox: { backgroundColor: ROW, padding: "6 10", marginBottom: 10, borderLeftWidth: 3, borderLeftColor: BK },
  appliedToLabel: { fontSize: 7.5, color: LT, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 2 },
  appliedToValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BK },

  // ── Saldo a favor ──────────────────────────────────────────────────────
  creditBox: { borderWidth: 1, borderColor: BK, padding: "10 12", marginBottom: 14 },
  creditLabel: { fontSize: 7.5, color: LT, fontFamily: "Helvetica-Bold", letterSpacing: 1, marginBottom: 4 },
  creditRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  creditAmountUsd: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BK },
  creditAmountBss: { fontSize: 9, color: MID },
  creditNote: { fontSize: 7.5, color: MID, marginTop: 2 },

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: { position: "absolute", bottom: 24, left: 38, right: 38 },
  footerLine1: { height: 2, backgroundColor: BK, marginBottom: 3 },
  footerLine2: { height: 1, backgroundColor: BDR, marginBottom: 5 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerLeft:  { fontSize: 7, color: LT },
  footerRight: { fontSize: 7, color: LT, textAlign: "right" },
  footerLegal: { fontSize: 7, color: MID, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 4 },
});

function vcRow(label: string, value: string) {
  return React.createElement(View, { style: vc.vRow },
    React.createElement(Text, { style: vc.vLbl }, label),
    React.createElement(Text, { style: vc.vVal }, value),
  );
}

function VoucherDoc({ data }: { data: PaymentVoucherData }) {
  const paidStr = data.paidAt.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });
  const paidShort = data.paidAt.toLocaleDateString("es-VE");
  const shortRef = data.paymentId.slice(-8).toUpperCase();
  const genStr = new Date().toLocaleDateString("es-VE");
  const isAnticipo = data.invoices.length === 0;

  const fmtUsd = (v: string | number) => `$${Number(v).toFixed(2)}`;

  return React.createElement(Document, { title: `Comprobante de Pago — ${shortRef}` },
    React.createElement(Page, { size: "A4", style: vc.page },

      // ── Membrete ────────────────────────────────────────────────
      React.createElement(View, { style: vc.header },
        React.createElement(View, { style: vc.headerTop },
          React.createElement(View, null,
            React.createElement(Text, { style: vc.communityName }, data.communityName.toUpperCase()),
            React.createElement(Text, { style: vc.communityMeta },
              "JUNTA DE CONDOMINIO" + (data.communityRif ? "   RIF: " + data.communityRif : "")),
            React.createElement(Text, { style: { ...vc.communityMeta, marginTop: 1 } },
              [data.communityAddress, data.communityPhone, data.communityEmail].filter(Boolean).join("   ")),
          ),
          React.createElement(View, { style: vc.headerRight },
            React.createElement(Text, { style: vc.headerDocLabel }, "Comprobante N°"),
            React.createElement(Text, { style: vc.headerDocNum }, shortRef),
            React.createElement(Text, { style: { fontSize: 8, color: MID, textAlign: "right", marginTop: 1 } }, paidShort),
          ),
        ),
        React.createElement(View, { style: vc.thinLine }),
      ),

      // ── Título ──────────────────────────────────────────────────
      React.createElement(View, { style: vc.titleBlock },
        React.createElement(Text, { style: vc.docTitle }, "COMPROBANTE DE PAGO"),
        React.createElement(Text, { style: vc.docSubtitle },
          "Constancia de pago emitida por la Junta de Condominio"),
        React.createElement(View, { style: vc.refRow },
          React.createElement(Text, { style: vc.refItem },
            React.createElement(Text, { style: vc.refLabel }, "Referencia: "), shortRef),
          React.createElement(Text, { style: vc.refItem },
            React.createElement(Text, { style: vc.refLabel }, "Fecha de pago: "), paidStr),
          React.createElement(Text, { style: vc.refItem },
            React.createElement(Text, { style: vc.refLabel }, "Unidad: "), data.unitCode),
        ),
      ),

      // ── Monto principal ─────────────────────────────────────────
      React.createElement(View, { style: vc.amountOuter },
        React.createElement(View, { style: vc.amountHeader },
          React.createElement(Text, { style: vc.amountHeaderText }, "MONTO RECIBIDO POR LA JUNTA DE CONDOMINIO"),
        ),
        React.createElement(View, { style: vc.amountBody },
          React.createElement(View, { style: vc.amountLeft },
            React.createElement(Text, { style: vc.amountLabelText }, "Total recibido (Dólares estadounidenses):"),
            React.createElement(Text, { style: vc.amountUsdText },
              `$${Number(data.amountUsd).toFixed(2)} USD`),
            React.createElement(Text, { style: vc.amountBssText },
              `Bs ${Number(data.amountBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
            React.createElement(Text, { style: vc.amountRateText },
              `Tasa BCV aplicada: ${Number(data.exchangeRate).toFixed(4)} Bs/$`),
          ),
          React.createElement(View, { style: vc.stampBox },
            React.createElement(Text, { style: vc.stampCheckmark }, "✓"),
            React.createElement(Text, { style: vc.stampVerified }, "RECIBIDO"),
            React.createElement(Text, { style: vc.stampDate }, paidStr),
          ),
        ),
      ),

      // ── Datos del pago | Propietario y Unidad ───────────────────
      React.createElement(View, { style: vc.twoCol },
        React.createElement(View, { style: vc.card },
          React.createElement(View, { style: vc.cardHeader },
            React.createElement(Text, { style: vc.cardHeaderText }, "DATOS DEL PAGO"),
          ),
          React.createElement(View, { style: vc.cardBody },
            React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Método:"),
              React.createElement(Text, { style: vc.vVal }, METHOD_LABEL[data.method] ?? data.method),
            ),
            data.reference ? React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "N° Referencia:"),
              React.createElement(Text, { style: vc.vVal }, data.reference),
            ) : null,
            React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Fecha de pago:"),
              React.createElement(Text, { style: vc.vVal }, paidStr),
            ),
            React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Ref. sistema:"),
              React.createElement(Text, { style: vc.vVal }, shortRef),
            ),
          ),
        ),
        React.createElement(View, { style: vc.card },
          React.createElement(View, { style: vc.cardHeader },
            React.createElement(Text, { style: vc.cardHeaderText }, "PROPIETARIO Y UNIDAD"),
          ),
          React.createElement(View, { style: vc.cardBody },
            React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Propietario:"),
              React.createElement(Text, { style: vc.vVal }, data.personName),
            ),
            data.personId ? React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Cédula / RIF:"),
              React.createElement(Text, { style: vc.vVal }, data.personId),
            ) : null,
            React.createElement(View, { style: vc.vRow },
              React.createElement(Text, { style: vc.vLbl }, "Unidad:"),
              React.createElement(Text, { style: vc.vVal }, data.unitCode),
            ),
          ),
        ),
      ),

      // ── Aplicado a: (resumen rápido pedido por el cliente) ────────
      !isAnticipo && data.invoices.length > 0 && React.createElement(View, { style: vc.appliedToBox },
        React.createElement(Text, { style: vc.appliedToLabel }, "APLICADO A:"),
        React.createElement(Text, { style: vc.appliedToValue },
          data.invoices.map((iv) => iv.period).join("  ·  ")
        ),
      ),

      // ── Recibos aplicados ────────────────────────────────────────
      !isAnticipo && React.createElement(View, { style: vc.invoiceSection },
        React.createElement(Text, { style: vc.invoiceSectionTitle }, "RECIBOS DE CONDOMINIO APLICADOS"),
        React.createElement(View, { style: vc.invoiceTableHead },
          React.createElement(Text, { style: vc.invoiceThDesc }, "N° Recibo"),
          React.createElement(Text, { style: vc.invoiceThPeriod }, "Período"),
          React.createElement(Text, { style: vc.invoiceThAmt }, "Monto USD"),
        ),
        ...data.invoices.map((ivRow, i) =>
          React.createElement(View, { key: i, style: i % 2 === 0 ? vc.invoiceRow : vc.invoiceRowAlt },
            React.createElement(Text, { style: vc.invoiceTdDesc }, ivRow.number),
            React.createElement(Text, { style: vc.invoiceTdPeriod }, ivRow.period),
            React.createElement(Text, { style: vc.invoiceTdAmt }, fmtUsd(ivRow.amountUsd)),
          )
        ),
      ),

      // ── Saldo a favor (cuando hay aplicación + sobrante) ─────────
      !isAnticipo && data.creditUsd && Number(data.creditUsd) > 0.005 && React.createElement(View, { style: vc.creditBox },
        React.createElement(Text, { style: vc.creditLabel }, "SALDO A FAVOR"),
        React.createElement(View, { style: vc.creditRow },
          React.createElement(Text, { style: vc.creditAmountUsd }, "$" + Number(data.creditUsd).toFixed(2) + " USD"),
          data.creditBss && React.createElement(Text, { style: vc.creditAmountBss },
            "Bs " + Number(data.creditBss).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        ),
        React.createElement(Text, { style: vc.creditNote },
          "El monto excedente quedará como crédito a favor del propietario y será descontado de los próximos Recibos de Condominio."),
      ),

      // ── Anticipo ─────────────────────────────────────────────────
      isAnticipo && React.createElement(View, { style: vc.anticipoBox },
        React.createElement(Text, { style: vc.anticipoText },
          "ANTICIPO / ADELANTO DE PAGO: Este pago no ha sido aplicado a un recibo específico. " +
          "El monto de $" + Number(data.amountUsd).toFixed(2) + " USD quedará registrado como crédito a " +
          "favor del propietario y será descontado de los próximos Recibos de Condominio."),
      ),

      // ── Footer ───────────────────────────────────────────────────
      React.createElement(View, { style: vc.footer },
        React.createElement(View, { style: vc.footerLine2 }),
        React.createElement(View, { style: vc.footerLine1 }),
        React.createElement(View, { style: vc.footerRow },
          React.createElement(Text, { style: vc.footerLeft },
            `Generado el ${genStr}   ${data.communityName}   Ref: ${shortRef}`),
          React.createElement(Text, { style: vc.footerRight },
            "Conserve este comprobante como constancia oficial de pago"),
        ),
        React.createElement(Text, { style: vc.footerLegal },
          "Comprobante emitido por la Junta de Condominio — Ley de Propiedad Horizontal, Art. 14 — Republica Bolivariana de Venezuela"),
      ),
    ),
  );
}

export async function generatePaymentVoucherPdf(data: PaymentVoucherData): Promise<Buffer> {
  return renderToBuffer(VoucherDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Factura Centro Comercial ─────────────────────────────────────────────────

const TYPE_LABEL_CC: Record<string, string> = {
  CANON: "Canon de Arrendamiento",
  CANON_SALES: "Canon sobre Ventas",
  ALIQUOT: "Alícuota de Gastos Comunes",
  EXTRA_FEE: "Cargo Extraordinario",
  FINE: "Multa",
  OTHER: "Otro",
};

const STATUS_LABEL_CC: Record<string, string> = {
  DRAFT: "BORRADOR", ISSUED: "EMITIDA", PARTIAL: "PAGO PARCIAL",
  PAID: "CANCELADA", OVERDUE: "VENCIDA", VOIDED: "ANULADA",
};

export type CcInvoicePdfData = {
  // Mall
  mallName: string;
  mallAddress: string;
  mallRif?: string | null;
  mallPhone?: string | null;
  mallEmail?: string | null;
  mallCity?: string | null;
  // Factura
  invoiceNumber: string;
  periodYear: number;
  periodMonth: number;
  issuedAt: Date;
  dueDate: Date;
  status: string;
  type: string;
  exchangeRate: string;
  // Local
  localCode: string;
  localName?: string | null;
  localFloor?: number | null;
  // Arrendatario
  tenantName?: string | null;
  tenantRif?: string | null;
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  // Ítems
  items: { description: string; amountUsd: string; amountBss: string }[];
  totalUsd: string;
  totalBss: string;
  paidUsd: string;
  paidBss: string;
  notes?: string | null;
  paymentInstructions?: string | null;
};

// Reutilizamos la paleta monocromática
const cc = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "32 38", color: DK, backgroundColor: "#fff" },

  header: { marginBottom: 12, borderBottomWidth: 2, borderBottomColor: BK, paddingBottom: 10 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  mallName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 0.3, marginBottom: 3 },
  mallMeta: { fontSize: 8, color: MID, lineHeight: 1.5 },
  headerRight: { alignItems: "flex-end" },
  headerDocLabel: { fontSize: 8, color: MID, textAlign: "right" },
  headerDocNum: { fontSize: 11, fontFamily: "Helvetica-Bold", color: BK, textAlign: "right", marginTop: 2 },
  thinLine: { height: 1, backgroundColor: BDR, marginTop: 8 },

  titleBlock: { borderBottomWidth: 1, borderBottomColor: BDR2, paddingBottom: 10, marginBottom: 14 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 2, marginBottom: 3 },
  docSubtitle: { fontSize: 7.5, color: MID },
  docMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  docMetaItem: { fontSize: 8, color: DK },
  docMetaLabel: { color: LT },

  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  card: { flex: 1, borderWidth: 1, borderColor: BDR },
  cardHeader: { backgroundColor: BK, padding: "4 8" },
  cardHeaderText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 1 },
  cardBody: { padding: "7 8" },
  dataRow: { flexDirection: "row", marginBottom: 4 },
  dataLabel: { width: "42%", color: LT, fontSize: 8 },
  dataValue: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8, color: DK },

  tableSection: { marginBottom: 12 },
  tableSectionTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: BK, letterSpacing: 1,
                      borderBottomWidth: 1, borderBottomColor: BK, paddingBottom: 4, marginBottom: 0 },
  tableHead: { flexDirection: "row", backgroundColor: BK, padding: "5 7" },
  thDesc: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5 },
  thUsd: { width: 75, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "right" },
  thBss: { width: 90, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, textAlign: "right" },
  tableRow: { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2 },
  tableRowAlt: { flexDirection: "row", padding: "5 7", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  tdDesc: { flex: 1, color: DK, fontSize: 8 },
  tdUsd: { width: 75, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 8 },
  tdBss: { width: 90, textAlign: "right", color: MID, fontSize: 8 },

  totalsBox: { marginBottom: 12, borderWidth: 1, borderColor: BDR },
  totalLineRow: { flexDirection: "row", padding: "5 8", borderBottomWidth: 1, borderBottomColor: BDR2 },
  totalLineLabel: { flex: 1, color: DK, fontSize: 8.5 },
  totalLineUsd: { width: 75, textAlign: "right", fontSize: 8.5 },
  totalLineBss: { width: 90, textAlign: "right", color: MID, fontSize: 8.5 },
  deductionRow: { flexDirection: "row", padding: "5 8", borderBottomWidth: 1, borderBottomColor: BDR2, backgroundColor: ROW },
  deductionLabel: { flex: 1, color: MID, fontSize: 8.5 },
  deductionUsd: { width: 75, textAlign: "right", color: MID, fontSize: 8.5 },
  deductionBss: { width: 90, textAlign: "right", color: MID, fontSize: 8.5 },
  grandTotalRow: { flexDirection: "row", padding: "8 8", backgroundColor: BK },
  gtLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtUsd: { width: 75, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtBss: { width: 90, textAlign: "right", color: "#cccccc", fontFamily: "Helvetica-Bold", fontSize: 9 },
  cancelledRow: { flexDirection: "row", padding: "8 8", backgroundColor: DK },
  cancelledLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledUsd: { width: 75, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledBss: { width: 90, textAlign: "right", color: "#cccccc", fontFamily: "Helvetica-Bold", fontSize: 9 },

  rateBox: { flexDirection: "row", borderWidth: 1, borderColor: BDR,
             padding: "4 8", marginBottom: 10, alignItems: "center", backgroundColor: ROW },
  rateLabel: { color: MID, fontSize: 7.5, flex: 1 },

  notesBox: { borderWidth: 1, borderColor: BDR, padding: "6 8", marginBottom: 10 },
  notesTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: DK, marginBottom: 3 },
  notesText: { fontSize: 8, color: MID },

  footer: { position: "absolute", bottom: 24, left: 38, right: 38 },
  footerLine1: { height: 2, backgroundColor: BK, marginBottom: 3 },
  footerLine2: { height: 1, backgroundColor: BDR, marginBottom: 5 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerLeft: { fontSize: 7, color: LT },
  footerRight: { fontSize: 7, color: LT, textAlign: "right" },
  footerLegal: { fontSize: 7, color: MID, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 4 },
});

function ccDr(label: string, value: string) {
  return React.createElement(View, { style: cc.dataRow },
    React.createElement(Text, { style: cc.dataLabel }, label),
    React.createElement(Text, { style: cc.dataValue }, value),
  );
}

function CcInvoiceDoc({ data }: { data: CcInvoicePdfData }) {
  const mes = MESES_ES[(data.periodMonth - 1)] ?? "";
  const periodo = `${mes} ${data.periodYear}`;
  const pendingUsd = Math.max(0, Number(data.totalUsd) - Number(data.paidUsd));
  const pendingBss = Math.max(0, Number(data.totalBss) - Number(data.paidBss));
  const isPaid = pendingUsd < 0.005;
  const isPartial = !isPaid && Number(data.paidUsd) > 0.005;
  const statusLabel = STATUS_LABEL_CC[data.status] ?? data.status;
  const issuedStr = data.issuedAt.toLocaleDateString("es-VE");
  const dueStr = data.dueDate.toLocaleDateString("es-VE");
  const genStr = new Date().toLocaleDateString("es-VE");

  const fmtUsd = (v: string | number) => `$${Number(v).toFixed(2)}`;
  const fmtBss = (v: string | number) =>
    `Bs ${Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return React.createElement(Document, { title: `Factura CC ${data.invoiceNumber}` },
    React.createElement(Page, { size: "A4", style: cc.page },

      // ── Membrete ────────────────────────────────────────
      React.createElement(View, { style: cc.header },
        React.createElement(View, { style: cc.headerTop },
          React.createElement(View, null,
            React.createElement(Text, { style: cc.mallName }, data.mallName.toUpperCase()),
            React.createElement(Text, { style: cc.mallMeta },
              "CENTRO COMERCIAL" + (data.mallRif ? "   RIF: " + data.mallRif : "")),
            React.createElement(Text, { style: { ...cc.mallMeta, marginTop: 1 } },
              [data.mallAddress, data.mallCity, data.mallPhone, data.mallEmail].filter(Boolean).join("   ")),
          ),
          React.createElement(View, { style: cc.headerRight },
            React.createElement(Text, { style: cc.headerDocLabel }, "N° Factura"),
            React.createElement(Text, { style: cc.headerDocNum }, data.invoiceNumber),
            React.createElement(Text, { style: { fontSize: 8, color: MID, textAlign: "right", marginTop: 1 } }, issuedStr),
          ),
        ),
        React.createElement(View, { style: cc.thinLine }),
      ),

      // ── Título ──────────────────────────────────────────
      React.createElement(View, { style: cc.titleBlock },
        React.createElement(Text, { style: cc.docTitle }, "FACTURA DE ARRENDAMIENTO"),
        React.createElement(Text, { style: cc.docSubtitle },
          `${TYPE_LABEL_CC[data.type] ?? data.type} — Decreto con Rango, Valor y Fuerza de Ley de Regulación del Arrendamiento Inmobiliario para el Uso Comercial`),
        React.createElement(View, { style: cc.docMeta },
          React.createElement(Text, { style: cc.docMetaItem },
            React.createElement(Text, { style: cc.docMetaLabel }, "Período: "), periodo),
          React.createElement(Text, { style: cc.docMetaItem },
            React.createElement(Text, { style: cc.docMetaLabel }, "Emisión: "), issuedStr),
          React.createElement(Text, { style: cc.docMetaItem },
            React.createElement(Text, { style: cc.docMetaLabel }, "Vence: "), dueStr),
          React.createElement(Text, { style: cc.docMetaItem },
            React.createElement(Text, { style: cc.docMetaLabel }, "Estado: "), statusLabel),
        ),
      ),

      // ── Dos columnas: local | arrendatario ──────────────
      React.createElement(View, { style: cc.twoCol },
        React.createElement(View, { style: cc.card },
          React.createElement(View, { style: cc.cardHeader },
            React.createElement(Text, { style: cc.cardHeaderText }, "DATOS DEL LOCAL"),
          ),
          React.createElement(View, { style: cc.cardBody },
            ccDr("Código:", data.localCode),
            data.localName ? ccDr("Nombre:", data.localName) : null,
            data.localFloor != null ? ccDr("Piso:", String(data.localFloor)) : null,
            ccDr("Centro Comercial:", data.mallName),
          ),
        ),
        React.createElement(View, { style: cc.card },
          React.createElement(View, { style: cc.cardHeader },
            React.createElement(Text, { style: cc.cardHeaderText }, "ARRENDATARIO"),
          ),
          React.createElement(View, { style: cc.cardBody },
            ccDr("Razón Social:", data.tenantName ?? "—"),
            data.tenantRif ? ccDr("RIF:", data.tenantRif) : null,
            data.tenantPhone ? ccDr("Teléfono:", data.tenantPhone) : null,
            data.tenantEmail ? ccDr("Email:", data.tenantEmail) : null,
          ),
        ),
      ),

      // ── Conceptos ───────────────────────────────────────
      React.createElement(View, { style: cc.tableSection },
        React.createElement(Text, { style: cc.tableSectionTitle }, "CONCEPTOS FACTURADOS"),
        React.createElement(View, { style: cc.tableHead },
          React.createElement(Text, { style: cc.thDesc }, "Descripción"),
          React.createElement(Text, { style: cc.thUsd }, "USD"),
          React.createElement(Text, { style: cc.thBss }, "Bs.S"),
        ),
        ...data.items.map((item, i) =>
          React.createElement(View, { key: i, style: i % 2 === 0 ? cc.tableRow : cc.tableRowAlt },
            React.createElement(Text, { style: cc.tdDesc }, item.description),
            React.createElement(Text, { style: cc.tdUsd }, fmtUsd(item.amountUsd)),
            React.createElement(Text, { style: cc.tdBss }, fmtBss(item.amountBss)),
          )
        ),
      ),

      // ── Totales ─────────────────────────────────────────
      React.createElement(View, { style: cc.totalsBox },
        React.createElement(View, { style: cc.totalLineRow },
          React.createElement(Text, { style: cc.totalLineLabel }, "Total de la factura"),
          React.createElement(Text, { style: cc.totalLineUsd }, fmtUsd(data.totalUsd)),
          React.createElement(Text, { style: cc.totalLineBss }, fmtBss(data.totalBss)),
        ),
        Number(data.paidUsd) > 0.005 && React.createElement(View, { style: cc.deductionRow },
          React.createElement(Text, { style: cc.deductionLabel }, "(–) Abonos recibidos"),
          React.createElement(Text, { style: cc.deductionUsd }, `– ${fmtUsd(data.paidUsd)}`),
          React.createElement(Text, { style: cc.deductionBss }, `– ${fmtBss(data.paidBss)}`),
        ),
        isPaid
          ? React.createElement(View, { style: cc.cancelledRow },
              React.createElement(Text, { style: cc.cancelledLabel }, "SALDO TOTAL: CANCELADO"),
              React.createElement(Text, { style: cc.cancelledUsd }, "$0.00"),
              React.createElement(Text, { style: cc.cancelledBss }, "Bs 0,00"),
            )
          : React.createElement(View, { style: cc.grandTotalRow },
              React.createElement(Text, { style: cc.gtLabel }, isPartial ? "SALDO PENDIENTE" : "TOTAL A PAGAR"),
              React.createElement(Text, { style: cc.gtUsd }, fmtUsd(pendingUsd)),
              React.createElement(Text, { style: cc.gtBss }, fmtBss(pendingBss)),
            ),
      ),

      // ── Tasa BCV ────────────────────────────────────────
      React.createElement(View, { style: cc.rateBox },
        React.createElement(Text, { style: cc.rateLabel },
          `Tasa BCV aplicada: ${Number(data.exchangeRate).toFixed(4)} Bs/$ al momento de emisión   —   El monto en USD es fijo; el equivalente en Bs puede variar.`),
      ),

      // ── Instrucciones de pago CC ────────────────────────
      !isPaid && data.paymentInstructions && React.createElement(View, { style: cc.notesBox },
        React.createElement(Text, { style: cc.notesTitle }, "¿CÓMO PAGAR?"),
        React.createElement(Text, { style: cc.notesText }, data.paymentInstructions),
        React.createElement(Text, { style: { ...cc.notesText, fontFamily: "Helvetica-Bold", marginTop: 4 } },
          `Incluya el número de factura ${data.invoiceNumber} en el concepto del pago.`),
      ),

      // ── Notas de la factura ─────────────────────────────
      data.notes && React.createElement(View, { style: cc.notesBox },
        React.createElement(Text, { style: cc.notesTitle }, "Observaciones:"),
        React.createElement(Text, { style: cc.notesText }, data.notes),
      ),

      // ── Footer ──────────────────────────────────────────
      React.createElement(View, { style: cc.footer },
        React.createElement(View, { style: cc.footerLine2 }),
        React.createElement(View, { style: cc.footerLine1 }),
        React.createElement(View, { style: cc.footerRow },
          React.createElement(Text, { style: cc.footerLeft },
            `Emitida el ${genStr}   ${data.mallName}`),
          React.createElement(Text, { style: cc.footerRight },
            "Los montos en Bs.S se calculan con la tasa BCV del período de emisión"),
        ),
        React.createElement(Text, { style: cc.footerLegal },
          "Decreto con Rango, Valor y Fuerza de Ley de Regulacion del Arrendamiento Inmobiliario para el Uso Comercial — Republica Bolivariana de Venezuela"),
      ),
    ),
  );
}

export async function generateCcInvoicePdf(data: CcInvoicePdfData): Promise<Buffer> {
  return renderToBuffer(CcInvoiceDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}
