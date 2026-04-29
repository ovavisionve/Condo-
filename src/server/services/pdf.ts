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
