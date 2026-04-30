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

const inv = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "30 36", color: "#111827", backgroundColor: "#fff" },
  // Header de la comunidad
  communityHeader: { backgroundColor: "#1e3a5f", padding: "14 16", marginBottom: 0, borderRadius: "4 4 0 0" },
  communityName: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#fff", marginBottom: 2 },
  communitySubtitle: { fontSize: 8, color: "#93c5fd" },
  // Banda del título de recibo
  receiptBand: { backgroundColor: "#e8f0fe", padding: "8 16", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  receiptTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1e3a5f", letterSpacing: 1 },
  receiptNumber: { fontSize: 9, color: "#4b5563" },
  // Layout de dos columnas
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  card: { flex: 1, border: "1 solid #e5e7eb", borderRadius: 4, padding: "8 10" },
  cardTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, borderBottom: "1 solid #f3f4f6", paddingBottom: 3 },
  dataRow: { flexDirection: "row", marginBottom: 3 },
  dataLabel: { width: "42%", color: "#6b7280", fontSize: 8 },
  dataValue: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8 },
  // Tabla de conceptos
  tableSection: { marginBottom: 10 },
  tableTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1e3a5f", marginBottom: 4, padding: "4 0", borderBottom: "2 solid #1e3a5f" },
  tableHead: { flexDirection: "row", backgroundColor: "#1e3a5f", padding: "5 6", borderRadius: "2 2 0 0" },
  thDesc: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8 },
  thAliq: { width: 50, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  thUsd: { width: 65, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  thBss: { width: 80, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, textAlign: "right" },
  tableBody: { border: "1 solid #e5e7eb", borderTop: 0, borderRadius: "0 0 2 2" },
  tableRow: { flexDirection: "row", padding: "5 6", borderBottom: "1 solid #f3f4f6" },
  tableRowAlt: { flexDirection: "row", padding: "5 6", borderBottom: "1 solid #f3f4f6", backgroundColor: "#f9fafb" },
  tdDesc: { flex: 1, color: "#374151" },
  tdAliq: { width: 50, color: "#6b7280", textAlign: "right" },
  tdUsd: { width: 65, textAlign: "right" },
  tdBss: { width: 80, textAlign: "right", color: "#6b7280" },
  // Totales
  totalsBox: { marginBottom: 10 },
  totalLineRow: { flexDirection: "row", padding: "4 6", borderBottom: "1 solid #f3f4f6" },
  totalLineLabel: { flex: 1, color: "#374151" },
  totalLineUsd: { width: 65, textAlign: "right" },
  totalLineBss: { width: 80, textAlign: "right", color: "#6b7280" },
  deductionRow: { flexDirection: "row", padding: "4 6", borderBottom: "1 solid #f3f4f6", backgroundColor: "#f0fdf4" },
  deductionLabel: { flex: 1, color: "#166534" },
  deductionUsd: { width: 65, textAlign: "right", color: "#166534" },
  deductionBss: { width: 80, textAlign: "right", color: "#166534" },
  grandTotalRow: { flexDirection: "row", padding: "8 6", backgroundColor: "#1e3a5f", borderRadius: 4, marginTop: 4 },
  gtLabel: { flex: 1, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtUsd: { width: 65, textAlign: "right", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 10 },
  gtBss: { width: 80, textAlign: "right", color: "#93c5fd", fontFamily: "Helvetica-Bold", fontSize: 10 },
  // Caja de tasa
  rateBox: { flexDirection: "row", backgroundColor: "#eff6ff", border: "1 solid #bfdbfe", borderRadius: 4, padding: "6 10", marginBottom: 10, alignItems: "center", gap: 8 },
  rateLabel: { color: "#1e40af", fontSize: 8 },
  rateValue: { fontFamily: "Helvetica-Bold", color: "#1e40af", fontSize: 9 },
  // Pagos aplicados
  paymentsTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#374151", marginBottom: 3 },
  paymentRow: { flexDirection: "row", padding: "3 0", borderBottom: "1 solid #f3f4f6" },
  paymentLabel: { flex: 1, color: "#374151" },
  paymentAmt: { width: 70, textAlign: "right", color: "#166534" },
  // Instrucciones de pago
  payInfoBox: { border: "1 solid #e5e7eb", borderRadius: 4, padding: "8 10", marginBottom: 10 },
  payInfoTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151", marginBottom: 4 },
  payInfoText: { fontSize: 8, color: "#6b7280", marginBottom: 2 },
  // Footer
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, borderTop: "1 solid #e5e7eb", paddingTop: 5 },
  footerText: { fontSize: 7, color: "#9ca3af", textAlign: "center" },
  // Badge de estado
  statusPaid: { fontSize: 8, color: "#166534", fontFamily: "Helvetica-Bold" },
  statusPending: { fontSize: 8, color: "#dc2626", fontFamily: "Helvetica-Bold" },
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

function r(label: string, value: string) {
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
  const isPaid = pendingUsd < 0.005;
  const issuedStr = data.issuedAt.toLocaleDateString("es-VE");
  const dueStr = data.dueDate.toLocaleDateString("es-VE");
  const idStr = data.ownerIdType && data.ownerIdNumber
    ? `${data.ownerIdType}-${data.ownerIdNumber}` : "";

  const fmtUsd = (v: string | number) => `$${Number(v).toFixed(2)}`;
  const fmtBss = (v: string | number) => `Bs ${Number(v).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return React.createElement(Document, { title: `Recibo ${data.invoiceNumber}` },
    React.createElement(Page, { size: "A4", style: inv.page },

      // ── Header comunidad ────────────────────────────────────────
      React.createElement(View, { style: inv.communityHeader },
        React.createElement(Text, { style: inv.communityName }, data.communityName.toUpperCase()),
        React.createElement(Text, { style: inv.communitySubtitle },
          [data.communityRif ? `RIF: ${data.communityRif}` : null,
           data.communityAddress,
           data.communityPhone].filter(Boolean).join("  ·  "),
        ),
      ),

      // ── Banda título ────────────────────────────────────────────
      React.createElement(View, { style: inv.receiptBand },
        React.createElement(Text, { style: inv.receiptTitle }, "RECIBO DE CONDOMINIO"),
        React.createElement(View, { style: { alignItems: "flex-end" } },
          React.createElement(Text, { style: { ...inv.receiptNumber, fontFamily: "Helvetica-Bold" } }, data.invoiceNumber),
          React.createElement(Text, { style: inv.receiptNumber }, `Período: ${periodo}`),
        ),
      ),

      // ── Dos columnas: factura | unidad/propietario ──────────────
      React.createElement(View, { style: inv.twoCol },
        // Columna izquierda: datos de la factura
        React.createElement(View, { style: inv.card },
          React.createElement(Text, { style: inv.cardTitle }, "Datos del recibo"),
          r("N° Recibo:", data.invoiceNumber),
          r("Período:", periodo),
          r("Fecha emisión:", issuedStr),
          r("Fecha vencimiento:", dueStr),
          React.createElement(View, { style: inv.dataRow },
            React.createElement(Text, { style: inv.dataLabel }, "Estado:"),
            React.createElement(Text, { style: isPaid ? inv.statusPaid : inv.statusPending },
              isPaid ? "✓ PAGADO" : pendingUsd < Number(data.totalUsd) - 0.005 ? "PAGO PARCIAL" : "PENDIENTE"),
          ),
        ),
        // Columna derecha: unidad y propietario
        React.createElement(View, { style: inv.card },
          React.createElement(Text, { style: inv.cardTitle }, "Unidad y propietario"),
          r("Unidad:", data.unitCode),
          data.unitTower ? r("Torre:", data.unitTower) : null,
          data.unitFloor != null ? r("Piso:", String(data.unitFloor)) : null,
          r("Propietario:", data.ownerName),
          idStr ? r("Cédula/RIF:", idStr) : null,
        ),
      ),

      // ── Tabla de conceptos ──────────────────────────────────────
      React.createElement(View, { style: inv.tableSection },
        React.createElement(Text, { style: inv.tableTitle }, "CONCEPTOS FACTURADOS"),
        React.createElement(View, { style: inv.tableHead },
          React.createElement(Text, { style: inv.thDesc }, "Concepto"),
          React.createElement(Text, { style: inv.thAliq }, "Alícuota"),
          React.createElement(Text, { style: inv.thUsd }, "USD"),
          React.createElement(Text, { style: inv.thBss }, "Bs.S"),
        ),
        React.createElement(View, { style: inv.tableBody },
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
        React.createElement(View, { style: inv.grandTotalRow },
          React.createElement(Text, { style: inv.gtLabel }, isPaid ? "SALDO: CANCELADO" : "TOTAL A PAGAR"),
          React.createElement(Text, { style: inv.gtUsd }, isPaid ? "$0.00" : fmtUsd(pendingUsd)),
          React.createElement(Text, { style: inv.gtBss }, isPaid ? "Bs 0.00" : fmtBss(pendingBss)),
        ),
      ),

      // ── Tasa de cambio ──────────────────────────────────────────
      React.createElement(View, { style: inv.rateBox },
        React.createElement(Text, { style: inv.rateLabel }, "Tasa de cambio aplicada:"),
        React.createElement(Text, { style: inv.rateValue },
          `${Number(data.exchangeRate).toFixed(4)} Bs/$ (${data.exchangeSource})`),
        React.createElement(Text, { style: { ...inv.rateLabel, flex: 1, textAlign: "right" } },
          `El saldo en USD es fijo. El equivalente en Bs puede variar según la tasa del día.`),
      ),

      // ── Pagos aplicados ─────────────────────────────────────────
      data.paymentsApplied && data.paymentsApplied.length > 0 &&
        React.createElement(View, { style: { marginBottom: 10 } },
          React.createElement(Text, { style: inv.paymentsTitle }, "Pagos recibidos en esta factura:"),
          ...data.paymentsApplied.map((p, i) =>
            React.createElement(View, { key: i, style: inv.paymentRow },
              React.createElement(Text, { style: inv.paymentLabel },
                `${p.paidAt.toLocaleDateString("es-VE")} · ${METHOD_SHORT[p.method] ?? p.method}${p.reference ? ` · Ref: ${p.reference}` : ""}`),
              React.createElement(Text, { style: inv.paymentAmt }, fmtUsd(p.amountUsd)),
            )
          ),
        ),

      // ── Instrucciones de pago ───────────────────────────────────
      !isPaid && React.createElement(View, { style: inv.payInfoBox },
        React.createElement(Text, { style: inv.payInfoTitle }, "INSTRUCCIONES DE PAGO"),
        React.createElement(Text, { style: inv.payInfoText },
          "Métodos aceptados: Transferencia bancaria, Pago Móvil, Zelle, Efectivo USD, Efectivo Bs"),
        data.bankAccounts && data.bankAccounts.length > 0
          ? data.bankAccounts.map((acc, i) =>
              React.createElement(Text, { key: i, style: inv.payInfoText },
                [
                  `${acc.bankName} · ${acc.accountType}`,
                  acc.accountNumber !== "-" ? `${acc.currency}: ${acc.accountNumber}` : null,
                  `A nombre de: ${acc.accountHolder}`,
                  acc.notes ? acc.notes : null,
                ].filter(Boolean).join("  ·  "))
            )
          : React.createElement(Text, { style: inv.payInfoText },
              "Contacta a la administración para obtener los datos bancarios."),
        React.createElement(Text, { style: { ...inv.payInfoText, marginTop: 4 } },
          `Incluye el N° de recibo ${data.invoiceNumber} en el concepto del pago.`),
      ),

      // ── Footer ─────────────────────────────────────────────────
      React.createElement(View, { style: inv.footer },
        React.createElement(Text, { style: inv.footerText },
          `Generado el ${new Date().toLocaleDateString("es-VE")} · ${data.communityName} · Este documento es de carácter informativo.`),
        React.createElement(Text, { style: { ...inv.footerText, marginTop: 1 } },
          "Los montos en Bs.S se calculan con la tasa BCV del período de emisión. Conserva este recibo como comprobante."),
      ),
    ),
  );
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(InvoiceDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}

// ─── Bauche / Comprobante de pago ─────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  CASH_BSS: "Efectivo Bs",
  CASH_USD: "Efectivo USD",
  TRANSFER_BSS: "Transferencia Bs",
  TRANSFER_USD: "Transferencia USD",
  ZELLE: "Zelle",
  PAGO_MOVIL: "Pago Móvil",
  CRYPTO: "Criptomoneda",
  CHECK: "Cheque",
  OTHER: "Otro",
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

const v = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: "30 36", color: "#111827", backgroundColor: "#fff" },
  header: { backgroundColor: "#1e3a5f", padding: "14 16", borderRadius: "4 4 0 0", marginBottom: 0 },
  headerName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#fff", marginBottom: 2 },
  headerSub: { fontSize: 8, color: "#93c5fd" },
  band: { backgroundColor: "#dcfce7", padding: "8 16", flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  bandTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#166534", letterSpacing: 1 },
  bandRef: { fontSize: 8, color: "#4b5563", textAlign: "right" },
  twoCol: { flexDirection: "row", gap: 12, marginBottom: 12 },
  card: { flex: 1, border: "1 solid #e5e7eb", borderRadius: 4, padding: "8 10" },
  cardTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, borderBottom: "1 solid #f3f4f6", paddingBottom: 3 },
  row: { flexDirection: "row", marginBottom: 3 },
  lbl: { width: "40%", color: "#6b7280", fontSize: 8 },
  val: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8 },
  amountBox: { backgroundColor: "#f0fdf4", border: "2 solid #16a34a", borderRadius: 6, padding: "12 16", marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amountLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#166534" },
  amountUsd: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#166534" },
  amountBss: { fontSize: 10, color: "#4b5563", marginTop: 2 },
  invoiceTable: { border: "1 solid #e5e7eb", borderRadius: 4, marginBottom: 12 },
  invoiceHead: { flexDirection: "row", backgroundColor: "#f9fafb", padding: "5 8", borderRadius: "3 3 0 0" },
  invoiceRow: { flexDirection: "row", padding: "5 8", borderTop: "1 solid #f3f4f6" },
  colDesc: { flex: 1, fontSize: 8 },
  colPeriod: { width: 60, fontSize: 8, textAlign: "center" },
  colAmt: { width: 70, fontSize: 8, textAlign: "right" },
  stamp: { border: "2 solid #16a34a", borderRadius: 4, padding: "6 12", alignSelf: "flex-end", marginBottom: 12 },
  stampText: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#16a34a", textAlign: "center" },
  stampDate: { fontSize: 8, color: "#4b5563", textAlign: "center", marginTop: 2 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, borderTop: "1 solid #e5e7eb", paddingTop: 5 },
  footerText: { fontSize: 7, color: "#9ca3af", textAlign: "center" },
});

function r2(label: string, value: string) {
  return React.createElement(View, { style: v.row },
    React.createElement(Text, { style: v.lbl }, label),
    React.createElement(Text, { style: v.val }, value),
  );
}

function VoucherDoc({ data }: { data: PaymentVoucherData }) {
  const paidStr = data.paidAt.toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" });
  const shortRef = data.paymentId.slice(-8).toUpperCase();

  return React.createElement(Document, { title: `Bauche-${shortRef}` },
    React.createElement(Page, { size: "A4", style: v.page },

      // Header comunidad
      React.createElement(View, { style: v.header },
        React.createElement(Text, { style: v.headerName }, data.communityName),
        React.createElement(Text, { style: v.headerSub },
          [data.communityAddress, data.communityRif ? `RIF: ${data.communityRif}` : null,
           data.communityPhone, data.communityEmail].filter(Boolean).join("  ·  ")),
      ),

      // Banda COMPROBANTE DE PAGO
      React.createElement(View, { style: v.band },
        React.createElement(Text, { style: v.bandTitle }, "COMPROBANTE DE PAGO"),
        React.createElement(View, { style: { alignItems: "flex-end" } },
          React.createElement(Text, { style: { ...v.bandRef, fontFamily: "Helvetica-Bold" } }, `Ref: ${shortRef}`),
          React.createElement(Text, { style: v.bandRef }, paidStr),
        ),
      ),

      // Monto destacado
      React.createElement(View, { style: v.amountBox },
        React.createElement(View, null,
          React.createElement(Text, { style: v.amountLabel }, "MONTO RECIBIDO"),
          React.createElement(Text, { style: v.amountUsd }, `$${Number(data.amountUsd).toFixed(2)} USD`),
          React.createElement(Text, { style: v.amountBss }, `Bs ${Number(data.amountBss).toFixed(2)}  (Tasa: ${Number(data.exchangeRate).toFixed(2)} Bs/USD)`),
        ),
        React.createElement(View, { style: v.stamp },
          React.createElement(Text, { style: v.stampText }, "✓ RECIBIDO"),
          React.createElement(Text, { style: v.stampDate }, paidStr),
        ),
      ),

      // Dos columnas: pago | propietario
      React.createElement(View, { style: v.twoCol },
        React.createElement(View, { style: v.card },
          React.createElement(Text, { style: v.cardTitle }, "Datos del pago"),
          r2("Método:", METHOD_LABEL[data.method] ?? data.method),
          data.reference ? r2("Referencia:", data.reference) : null,
          r2("Fecha:", paidStr),
          r2("Ref. sistema:", shortRef),
        ),
        React.createElement(View, { style: v.card },
          React.createElement(Text, { style: v.cardTitle }, "Propietario / Unidad"),
          r2("Nombre:", data.personName),
          data.personId ? r2("ID:", data.personId) : null,
          r2("Unidad:", data.unitCode),
        ),
      ),

      // Tabla de facturas aplicadas
      data.invoices.length > 0 && React.createElement(View, { style: v.invoiceTable },
        React.createElement(View, { style: v.invoiceHead },
          React.createElement(Text, { style: { ...v.colDesc, fontFamily: "Helvetica-Bold" } }, "Factura aplicada"),
          React.createElement(Text, { style: { ...v.colPeriod, fontFamily: "Helvetica-Bold" } }, "Período"),
          React.createElement(Text, { style: { ...v.colAmt, fontFamily: "Helvetica-Bold" } }, "Monto USD"),
        ),
        ...data.invoices.map((inv, i) =>
          React.createElement(View, { key: i, style: v.invoiceRow },
            React.createElement(Text, { style: v.colDesc }, inv.number),
            React.createElement(Text, { style: v.colPeriod }, inv.period),
            React.createElement(Text, { style: v.colAmt }, `$${Number(inv.amountUsd).toFixed(2)}`),
          )
        ),
      ),

      data.invoices.length === 0 && React.createElement(View, { style: { ...v.card, marginBottom: 12, backgroundColor: "#fefce8" } },
        React.createElement(Text, { style: { ...v.lbl, color: "#854d0e" } }, "Pago registrado como anticipo — se aplicará a facturas pendientes."),
      ),

      // Footer
      React.createElement(View, { style: v.footer },
        React.createElement(Text, { style: v.footerText },
          `${data.communityName}  ·  Documento generado el ${new Date().toLocaleDateString("es-VE")}  ·  Ref: ${shortRef}`),
        React.createElement(Text, { style: { ...v.footerText, marginTop: 1 } },
          "Este comprobante es válido como constancia de pago. Consérvelo para sus registros."),
      ),
    ),
  );
}

export async function generatePaymentVoucherPdf(data: PaymentVoucherData): Promise<Buffer> {
  return renderToBuffer(VoucherDoc({ data }) as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);
}
