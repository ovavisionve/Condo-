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

// Paleta corporativa: Navy #1e3a5f · Gold #b8962e · Offwhite #f8f9fa
const NAVY  = "#1e3a5f";
const GOLD  = "#b8962e";
const GRAY1 = "#374151";  // texto principal
const GRAY2 = "#6b7280";  // texto secundario
const GRAY3 = "#e5e7eb";  // bordes
const GRAY4 = "#f3f4f6";  // fondo filas alternas
const GREEN = "#166534";
const RED   = "#991b1b";

const inv = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "28 32", color: GRAY1, backgroundColor: "#fff" },

  // ── Header ──────────────────────────────────────────────────────────────
  header: { backgroundColor: NAVY, padding: "0 0", marginBottom: 0 },
  headerTop: { padding: "12 16 4 16", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerLeft: {},
  communityName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.5, marginBottom: 3 },
  communityMeta: { fontSize: 7.5, color: "#93c5fd", lineHeight: 1.4 },
  headerRight: { alignItems: "flex-end" },
  headerRifBox: { fontSize: 7.5, color: "#93c5fd", textAlign: "right" },
  goldBar: { height: 3, backgroundColor: GOLD, marginTop: 8 },

  // ── Banda título documento ──────────────────────────────────────────────
  docBand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
             padding: "9 16", borderBottom: "1 solid " + GRAY3, marginBottom: 10 },
  docTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY, letterSpacing: 1.5 },
  docNumBox: { alignItems: "flex-end" },
  docNumber: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY },
  docPeriod: { fontSize: 8, color: GRAY2 },

  // ── Cards de dos columnas ───────────────────────────────────────────────
  twoCol: { flexDirection: "row", gap: 10, marginBottom: 10 },
  card: { flex: 1, border: "1 solid " + GRAY3, borderRadius: 3, overflow: "hidden" },
  cardHeader: { backgroundColor: NAVY, padding: "4 8" },
  cardHeaderText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.8, textTransform: "uppercase" },
  cardBody: { padding: "7 8" },
  dataRow: { flexDirection: "row", marginBottom: 3.5 },
  dataLabel: { width: "44%", color: GRAY2, fontSize: 8 },
  dataValue: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8, color: GRAY1 },

  // ── Estado ──────────────────────────────────────────────────────────────
  statusPaid:    { fontSize: 8.5, color: GREEN, fontFamily: "Helvetica-Bold" },
  statusPartial: { fontSize: 8.5, color: "#92400e", fontFamily: "Helvetica-Bold" },
  statusPending: { fontSize: 8.5, color: RED, fontFamily: "Helvetica-Bold" },

  // ── Tabla gastos comunes ────────────────────────────────────────────────
  tableSection: { marginBottom: 10 },
  tableSectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  tableSectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY, flex: 1 },
  tableSectionLine: { flex: 1, height: 1, backgroundColor: GOLD },
  tableHead: { flexDirection: "row", backgroundColor: NAVY, padding: "5 7" },
  thDesc: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  thAliq: { width: 56, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "center" },
  thUsd: { width: 68, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  thBss: { width: 86, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  tableRow:    { flexDirection: "row", padding: "5 7", borderBottom: "1 solid " + GRAY3 },
  tableRowAlt: { flexDirection: "row", padding: "5 7", borderBottom: "1 solid " + GRAY3, backgroundColor: GRAY4 },
  tdDesc: { flex: 1, color: GRAY1 },
  tdAliq: { width: 56, color: GRAY2, textAlign: "center" },
  tdUsd:  { width: 68, textAlign: "right", fontFamily: "Helvetica-Bold" },
  tdBss:  { width: 86, textAlign: "right", color: GRAY2 },

  // ── Totales ─────────────────────────────────────────────────────────────
  totalsBox: { marginBottom: 10, border: "1 solid " + GRAY3, borderRadius: 3 },
  totalLineRow: { flexDirection: "row", padding: "5 8", borderBottom: "1 solid " + GRAY3 },
  totalLineLabel: { flex: 1, color: GRAY1 },
  totalLineUsd: { width: 72, textAlign: "right" },
  totalLineBss: { width: 86, textAlign: "right", color: GRAY2 },
  deductionRow: { flexDirection: "row", padding: "5 8", borderBottom: "1 solid " + GRAY3, backgroundColor: "#f0fdf4" },
  deductionLabel: { flex: 1, color: GREEN },
  deductionUsd: { width: 72, textAlign: "right", color: GREEN },
  deductionBss: { width: 86, textAlign: "right", color: GREEN },
  grandTotalRow: { flexDirection: "row", padding: "8 8", backgroundColor: NAVY },
  gtLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtUsd:   { width: 72, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtBss:   { width: 86, textAlign: "right", color: "#93c5fd", fontFamily: "Helvetica-Bold", fontSize: 9 },
  cancelledRow: { flexDirection: "row", padding: "8 8", backgroundColor: GREEN },
  cancelledLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledUsd:   { width: 72, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  cancelledBss:   { width: 86, textAlign: "right", color: "#bbf7d0", fontFamily: "Helvetica-Bold", fontSize: 9 },

  // ── Tasa BCV ─────────────────────────────────────────────────────────────
  rateBox: { flexDirection: "row", backgroundColor: "#fffbeb", border: "1 solid #fde68a",
             borderRadius: 3, padding: "5 8", marginBottom: 9, alignItems: "center" },
  rateIcon: { width: 14, fontSize: 8, color: GOLD, fontFamily: "Helvetica-Bold" },
  rateLabel: { color: "#78350f", fontSize: 7.5, flex: 1 },
  rateValue:  { fontFamily: "Helvetica-Bold", color: "#78350f", fontSize: 8 },

  // ── Pagos aplicados ──────────────────────────────────────────────────────
  paymentsSection: { marginBottom: 9 },
  paymentsTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: GRAY1, marginBottom: 4,
                   borderBottom: "1 solid " + GRAY3, paddingBottom: 3 },
  paymentRow: { flexDirection: "row", padding: "3.5 0", borderBottom: "1 solid " + GRAY4 },
  paymentLabel: { flex: 1, color: GRAY1, fontSize: 8 },
  paymentAmt: { width: 70, textAlign: "right", color: GREEN, fontFamily: "Helvetica-Bold", fontSize: 8 },

  // ── Instrucciones de pago ────────────────────────────────────────────────
  payInfoBox: { border: "1 solid " + GRAY3, borderRadius: 3, marginBottom: 10, overflow: "hidden" },
  payInfoHeader: { backgroundColor: GRAY4, padding: "4 8" },
  payInfoTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  payInfoBody: { padding: "6 8" },
  payInfoText: { fontSize: 7.5, color: GRAY2, marginBottom: 2.5 },
  payInfoRef: { fontSize: 7.5, color: NAVY, fontFamily: "Helvetica-Bold", marginTop: 4 },

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: { position: "absolute", bottom: 20, left: 32, right: 32 },
  footerDivider: { height: 2, backgroundColor: NAVY, marginBottom: 5 },
  footerGold: { height: 1, backgroundColor: GOLD, marginBottom: 5 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerLeft: { fontSize: 7, color: GRAY2 },
  footerRight: { fontSize: 7, color: GRAY2, textAlign: "right" },
  footerLegal: { fontSize: 7, color: NAVY, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
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

  const statusStyle = isPaid ? inv.statusPaid : isPartial ? inv.statusPartial : inv.statusPending;
  const statusLabel = isPaid ? "CANCELADO" : isPartial ? "PAGO PARCIAL" : "PENDIENTE DE PAGO";

  return React.createElement(Document, { title: `Recibo de Condominio ${data.invoiceNumber}` },
    React.createElement(Page, { size: "A4", style: inv.page },

      // ── Header ─────────────────────────────────────────────────
      React.createElement(View, { style: inv.header },
        React.createElement(View, { style: inv.headerTop },
          React.createElement(View, { style: inv.headerLeft },
            React.createElement(Text, { style: inv.communityName }, data.communityName.toUpperCase()),
            React.createElement(Text, { style: inv.communityMeta },
              "JUNTA DE CONDOMINIO" +
              (data.communityRif ? "  |  RIF: " + data.communityRif : "")),
            React.createElement(Text, { style: { ...inv.communityMeta, marginTop: 2 } },
              [data.communityAddress, data.communityPhone].filter(Boolean).join("  ·  ")),
          ),
          React.createElement(View, { style: inv.headerRight },
            React.createElement(Text, { style: { ...inv.headerRifBox, fontFamily: "Helvetica-Bold", fontSize: 9 } },
              "RECIBO DE CONDOMINIO"),
            React.createElement(Text, { style: { ...inv.headerRifBox, marginTop: 3 } },
              data.invoiceNumber),
          ),
        ),
        React.createElement(View, { style: inv.goldBar }),
      ),

      // ── Banda doc ──────────────────────────────────────────────
      React.createElement(View, { style: inv.docBand },
        React.createElement(View, null,
          React.createElement(Text, { style: inv.docTitle }, "RECIBO DE CONDOMINIO"),
          React.createElement(Text, { style: { fontSize: 7.5, color: GRAY2, marginTop: 2 } },
            "Documento con fuerza ejecutiva — Art. 14 Ley de Propiedad Horizontal"),
        ),
        React.createElement(View, { style: inv.docNumBox },
          React.createElement(Text, { style: inv.docNumber }, data.invoiceNumber),
          React.createElement(Text, { style: inv.docPeriod }, `Período: ${periodo}`),
          React.createElement(Text, { style: { ...inv.docPeriod, marginTop: 2 } },
            `Emitido: ${issuedStr}  |  Vence: ${dueStr}`),
        ),
      ),

      // ── Dos columnas ───────────────────────────────────────────
      React.createElement(View, { style: inv.twoCol },
        React.createElement(View, { style: inv.card },
          React.createElement(View, { style: inv.cardHeader },
            React.createElement(Text, { style: inv.cardHeaderText }, "Datos del Recibo"),
          ),
          React.createElement(View, { style: inv.cardBody },
            dr("N° Recibo:", data.invoiceNumber),
            dr("Período:", periodo),
            dr("Fecha emisión:", issuedStr),
            dr("Fecha vencimiento:", dueStr),
            React.createElement(View, { style: inv.dataRow },
              React.createElement(Text, { style: inv.dataLabel }, "Estado:"),
              React.createElement(Text, { style: statusStyle }, statusLabel),
            ),
          ),
        ),
        React.createElement(View, { style: inv.card },
          React.createElement(View, { style: inv.cardHeader },
            React.createElement(Text, { style: inv.cardHeaderText }, "Unidad y Propietario"),
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

      // ── Gastos comunes ─────────────────────────────────────────
      React.createElement(View, { style: inv.tableSection },
        React.createElement(View, { style: inv.tableSectionHeader },
          React.createElement(Text, { style: inv.tableSectionTitle }, "GASTOS COMUNES"),
          React.createElement(View, { style: inv.tableSectionLine }),
        ),
        React.createElement(View, { style: inv.tableHead },
          React.createElement(Text, { style: inv.thDesc }, "Concepto"),
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
          )
        ),
      ),

      // ── Totales ─────────────────────────────────────────────────
      React.createElement(View, { style: inv.totalsBox },
        React.createElement(View, { style: inv.totalLineRow },
          React.createElement(Text, { style: inv.totalLineLabel }, "Subtotal facturado"),
          React.createElement(Text, { style: inv.totalLineUsd }, fmtUsd(data.totalUsd)),
          React.createElement(Text, { style: inv.totalLineBss }, fmtBss(data.totalBss)),
        ),
        Number(data.paidUsd) > 0.005 && React.createElement(View, { style: inv.deductionRow },
          React.createElement(Text, { style: inv.deductionLabel }, "(–) Pagos recibidos"),
          React.createElement(Text, { style: inv.deductionUsd }, `–${fmtUsd(data.paidUsd)}`),
          React.createElement(Text, { style: inv.deductionBss }, `–${fmtBss(data.paidBss)}`),
        ),
        isPaid
          ? React.createElement(View, { style: inv.cancelledRow },
              React.createElement(Text, { style: inv.cancelledLabel }, "SALDO: CANCELADO"),
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
        React.createElement(Text, { style: inv.rateIcon }, "BCV"),
        React.createElement(Text, { style: inv.rateLabel },
          `Tasa de cambio aplicada: `),
        React.createElement(Text, { style: inv.rateValue },
          `${Number(data.exchangeRate).toFixed(4)} Bs/$  (${data.exchangeSource})`),
        React.createElement(Text, { style: { ...inv.rateLabel, flex: 1, textAlign: "right" } },
          "El saldo en USD es fijo. El equiv. en Bs puede variar."),
      ),

      // ── Pagos recibidos ───────────────────────────────────────
      data.paymentsApplied && data.paymentsApplied.length > 0 &&
        React.createElement(View, { style: inv.paymentsSection },
          React.createElement(Text, { style: inv.paymentsTitle }, "Pagos recibidos en este recibo:"),
          ...data.paymentsApplied.map((p, i) =>
            React.createElement(View, { key: i, style: inv.paymentRow },
              React.createElement(Text, { style: inv.paymentLabel },
                `${p.paidAt.toLocaleDateString("es-VE")} · ${METHOD_SHORT[p.method] ?? p.method}` +
                (p.reference ? ` · Ref: ${p.reference}` : "")),
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
            "Métodos aceptados: Transferencia bancaria · Pago Móvil · Zelle · Efectivo USD · Efectivo Bs"),
          ...(data.bankAccounts && data.bankAccounts.length > 0
            ? data.bankAccounts.map((acc, i) =>
                React.createElement(Text, { key: i, style: inv.payInfoText },
                  [
                    `${acc.bankName} · ${acc.accountType}`,
                    acc.accountNumber !== "-" ? `${acc.currency}: ${acc.accountNumber}` : null,
                    `Titular: ${acc.accountHolder}`,
                    acc.notes ?? null,
                  ].filter(Boolean).join("  ·  "))
              )
            : [React.createElement(Text, { style: inv.payInfoText },
                "Contacte a la Junta de Condominio para obtener los datos bancarios.")]),
          React.createElement(Text, { style: inv.payInfoRef },
            `Incluir el N° de recibo ${data.invoiceNumber} en el concepto de la transferencia.`),
        ),
      ),

      // ── Footer ────────────────────────────────────────────────
      React.createElement(View, { style: inv.footer },
        React.createElement(View, { style: inv.footerGold }),
        React.createElement(View, { style: inv.footerDivider }),
        React.createElement(View, { style: inv.footerRow },
          React.createElement(Text, { style: inv.footerLeft },
            `Generado el ${genStr}  ·  ${data.communityName}`),
          React.createElement(Text, { style: inv.footerRight },
            "Los montos en Bs.S se calculan con la tasa BCV del período de emisión"),
        ),
        React.createElement(Text, { style: inv.footerLegal },
          "Titulo Ejecutivo segun el Articulo 14 de la Ley de Propiedad Horizontal de la Republica Bolivariana de Venezuela"),
      ),
    ),
  );
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(InvoiceDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
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
};

const vc = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "28 32", color: GRAY1, backgroundColor: "#fff" },

  // ── Header ─────────────────────────────────────────────────────────────
  header: { backgroundColor: NAVY, padding: "0 0", marginBottom: 0 },
  headerTop: { padding: "12 16 4 16", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  communityName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#ffffff", letterSpacing: 0.5, marginBottom: 3 },
  communityMeta: { fontSize: 7.5, color: "#93c5fd", lineHeight: 1.4 },
  headerRight: { alignItems: "flex-end" },
  headerDocType: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#ffffff", textAlign: "right" },
  headerRef: { fontSize: 8, color: "#93c5fd", textAlign: "right", marginTop: 3 },
  goldBar: { height: 3, backgroundColor: GOLD },

  // ── Banda de estado ─────────────────────────────────────────────────────
  statusBand: { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                padding: "8 16", borderBottom: "1 solid " + GRAY3, marginBottom: 12 },
  statusBandTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY, letterSpacing: 1.5 },
  statusBandRight: { alignItems: "flex-end" },
  statusBandRef: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: NAVY },
  statusBandDate: { fontSize: 8, color: GRAY2 },

  // ── Caja monto principal ────────────────────────────────────────────────
  amountOuter: { border: "1 solid " + GRAY3, borderRadius: 4, marginBottom: 12, overflow: "hidden" },
  amountHeader: { backgroundColor: NAVY, padding: "5 12" },
  amountHeaderText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 0.8 },
  amountBody: { flexDirection: "row", padding: "12 14", justifyContent: "space-between", alignItems: "center" },
  amountLeft: {},
  amountLabelText: { fontSize: 8.5, color: GRAY2, marginBottom: 2 },
  amountUsdText: { fontSize: 26, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  amountBssText: { fontSize: 9.5, color: GRAY2 },
  amountRateText: { fontSize: 7.5, color: GRAY2, marginTop: 2 },
  stampBox: { border: "2 solid " + GREEN, borderRadius: 4, padding: "8 14", alignItems: "center" },
  stampVerified: { fontSize: 12, fontFamily: "Helvetica-Bold", color: GREEN, letterSpacing: 1 },
  stampCheckmark: { fontSize: 18, color: GREEN, textAlign: "center", marginBottom: 2 },
  stampDate: { fontSize: 7.5, color: GRAY2, marginTop: 3, textAlign: "center" },

  // ── Cards dos columnas ──────────────────────────────────────────────────
  twoCol: { flexDirection: "row", gap: 10, marginBottom: 12 },
  card: { flex: 1, border: "1 solid " + GRAY3, borderRadius: 3, overflow: "hidden" },
  cardHeader: { backgroundColor: NAVY, padding: "4 8" },
  cardHeaderText: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 0.8 },
  cardBody: { padding: "7 8" },
  vRow: { flexDirection: "row", marginBottom: 3.5 },
  vLbl: { width: "40%", color: GRAY2, fontSize: 8 },
  vVal: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8, color: GRAY1 },

  // ── Tabla recibos aplicados ─────────────────────────────────────────────
  invoiceSection: { marginBottom: 12 },
  invoiceSectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  invoiceSectionTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY, flex: 1 },
  invoiceSectionLine: { flex: 1, height: 1, backgroundColor: GOLD },
  invoiceTableHead: { flexDirection: "row", backgroundColor: NAVY, padding: "5 7" },
  invoiceThDesc: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  invoiceThPeriod: { width: 70, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "center" },
  invoiceThAmt: { width: 80, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  invoiceRow: { flexDirection: "row", padding: "5 7", borderBottom: "1 solid " + GRAY3 },
  invoiceRowAlt: { flexDirection: "row", padding: "5 7", borderBottom: "1 solid " + GRAY3, backgroundColor: GRAY4 },
  invoiceTdDesc: { flex: 1, fontSize: 8, color: GRAY1 },
  invoiceTdPeriod: { width: 70, fontSize: 8, textAlign: "center", color: GRAY2 },
  invoiceTdAmt: { width: 80, fontSize: 8, textAlign: "right", fontFamily: "Helvetica-Bold", color: GREEN },

  // ── Anticipo notice ─────────────────────────────────────────────────────
  anticipoBox: { backgroundColor: "#fffbeb", border: "1 solid #fde68a", borderRadius: 3,
                  padding: "8 10", marginBottom: 12 },
  anticipoText: { fontSize: 8.5, color: "#78350f" },

  // ── Footer ──────────────────────────────────────────────────────────────
  footer: { position: "absolute", bottom: 20, left: 32, right: 32 },
  footerGold: { height: 1, backgroundColor: GOLD, marginBottom: 4 },
  footerDivider: { height: 2, backgroundColor: NAVY, marginBottom: 5 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerLeft: { fontSize: 7, color: GRAY2 },
  footerRight: { fontSize: 7, color: GRAY2, textAlign: "right" },
  footerLegal: { fontSize: 7, color: NAVY, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3 },
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

      // ── Header ──────────────────────────────────────────────────
      React.createElement(View, { style: vc.header },
        React.createElement(View, { style: vc.headerTop },
          React.createElement(View, null,
            React.createElement(Text, { style: vc.communityName }, data.communityName.toUpperCase()),
            React.createElement(Text, { style: vc.communityMeta },
              "JUNTA DE CONDOMINIO" +
              (data.communityRif ? "  |  RIF: " + data.communityRif : "")),
            React.createElement(Text, { style: { ...vc.communityMeta, marginTop: 2 } },
              [data.communityAddress, data.communityPhone, data.communityEmail].filter(Boolean).join("  ·  ")),
          ),
          React.createElement(View, { style: vc.headerRight },
            React.createElement(Text, { style: vc.headerDocType }, "COMPROBANTE DE PAGO"),
            React.createElement(Text, { style: vc.headerRef }, `Ref: ${shortRef}`),
            React.createElement(Text, { style: { ...vc.headerRef, marginTop: 1 } }, paidShort),
          ),
        ),
        React.createElement(View, { style: vc.goldBar }),
      ),

      // ── Banda título ────────────────────────────────────────────
      React.createElement(View, { style: vc.statusBand },
        React.createElement(View, null,
          React.createElement(Text, { style: vc.statusBandTitle }, "COMPROBANTE DE PAGO"),
          React.createElement(Text, { style: { fontSize: 7.5, color: GRAY2, marginTop: 2 } },
            "Constancia de pago emitida por la Junta de Condominio"),
        ),
        React.createElement(View, { style: vc.statusBandRight },
          React.createElement(Text, { style: vc.statusBandRef }, `Ref: ${shortRef}`),
          React.createElement(Text, { style: vc.statusBandDate }, paidStr),
        ),
      ),

      // ── Monto principal ─────────────────────────────────────────
      React.createElement(View, { style: vc.amountOuter },
        React.createElement(View, { style: vc.amountHeader },
          React.createElement(Text, { style: vc.amountHeaderText }, "MONTO RECIBIDO POR LA JUNTA DE CONDOMINIO"),
        ),
        React.createElement(View, { style: vc.amountBody },
          React.createElement(View, { style: vc.amountLeft },
            React.createElement(Text, { style: vc.amountLabelText }, "Total recibido en dólares (USD):"),
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

      // ── Dos columnas: datos pago | propietario/unidad ───────────
      React.createElement(View, { style: vc.twoCol },
        React.createElement(View, { style: vc.card },
          React.createElement(View, { style: vc.cardHeader },
            React.createElement(Text, { style: vc.cardHeaderText }, "Datos del Pago"),
          ),
          React.createElement(View, { style: vc.cardBody },
            vcRow("Método de pago:", METHOD_LABEL[data.method] ?? data.method),
            data.reference ? vcRow("Número de ref.:", data.reference) : null,
            vcRow("Fecha de pago:", paidStr),
            vcRow("Ref. sistema:", shortRef),
          ),
        ),
        React.createElement(View, { style: vc.card },
          React.createElement(View, { style: vc.cardHeader },
            React.createElement(Text, { style: vc.cardHeaderText }, "Propietario y Unidad"),
          ),
          React.createElement(View, { style: vc.cardBody },
            vcRow("Propietario:", data.personName),
            data.personId ? vcRow("Cédula / RIF:", data.personId) : null,
            vcRow("Unidad:", data.unitCode),
          ),
        ),
      ),

      // ── Recibos aplicados ────────────────────────────────────────
      !isAnticipo && React.createElement(View, { style: vc.invoiceSection },
        React.createElement(View, { style: vc.invoiceSectionHeader },
          React.createElement(Text, { style: vc.invoiceSectionTitle }, "RECIBOS APLICADOS"),
          React.createElement(View, { style: vc.invoiceSectionLine }),
        ),
        React.createElement(View, { style: vc.invoiceTableHead },
          React.createElement(Text, { style: vc.invoiceThDesc }, "N° Recibo de Condominio"),
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

      // ── Anticipo ─────────────────────────────────────────────────
      isAnticipo && React.createElement(View, { style: vc.anticipoBox },
        React.createElement(Text, { style: vc.anticipoText },
          "ANTICIPO / ADELANTO: Este pago no ha sido aplicado a un recibo específico. " +
          "El monto de $" + Number(data.amountUsd).toFixed(2) + " USD quedará registrado como crédito a favor " +
          "del propietario y se descontará de los próximos recibos de condominio."),
      ),

      // ── Footer ───────────────────────────────────────────────────
      React.createElement(View, { style: vc.footer },
        React.createElement(View, { style: vc.footerGold }),
        React.createElement(View, { style: vc.footerDivider }),
        React.createElement(View, { style: vc.footerRow },
          React.createElement(Text, { style: vc.footerLeft },
            `Generado el ${genStr}  ·  ${data.communityName}  ·  Ref: ${shortRef}`),
          React.createElement(Text, { style: vc.footerRight },
            "Conserve este comprobante como constancia de pago"),
        ),
        React.createElement(Text, { style: vc.footerLegal },
          "Comprobante de pago emitido por la Junta de Condominio — Ley de Propiedad Horizontal, Art. 14 — Republica Bolivariana de Venezuela"),
      ),
    ),
  );
}

export async function generatePaymentVoucherPdf(data: PaymentVoucherData): Promise<Buffer> {
  return renderToBuffer(VoucherDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}
