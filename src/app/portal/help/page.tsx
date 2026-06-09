"use client";

import Link from "next/link";

/**
 * Manual del residente — guía completa de cómo usar el portal.
 * Pedido cliente Reinaldo 8/jun/2026.
 *
 * Accesible desde el botón "❓ Ayuda" en el portal o por URL directa `/portal/help`.
 */

type Section = {
  id: string;
  title: string;
  icon: string;
  content: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "que-es",
    icon: "🏠",
    title: "¿Qué es el portal del residente?",
    content: (
      <>
        <p>
          Es tu acceso digital al condominio. Desde aquí podés ver y pagar tu recibo de
          condominio, notificar pagos, registrar visitas, ver el estado de cuenta general
          y comunicarte con la administración — todo desde el celular o computadora.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No necesitás instalar nada. Funciona desde cualquier navegador.
        </p>
      </>
    ),
  },
  {
    id: "ingresar",
    icon: "🔑",
    title: "Cómo ingresar al portal",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>La primera vez recibirás un email con un enlace de acceso (válido 7 días).</li>
          <li>Hacé clic en el enlace o copialo en tu navegador.</li>
          <li>Si perdiste el enlace, ingresá a <strong>condominios-theta.vercel.app/portal</strong> y pedí uno nuevo con tu email registrado.</li>
        </ol>
      </>
    ),
  },
  {
    id: "ver-recibo",
    icon: "📄",
    title: "Cómo ver y descargar mi recibo",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Entrá al portal.</li>
          <li>En la pestaña <strong>Principal</strong> verás tu último recibo emitido.</li>
          <li>Hacé clic en <strong>Ver PDF</strong> o <strong>Descargar</strong> para abrirlo.</li>
          <li>En <strong>Pendientes</strong> aparecen todos los recibos no pagados.</li>
        </ol>
        <p className="mt-2 text-sm">
          ⚠️ El monto en Bs es referencial. El monto USD es fijo y se convierte a Bs con
          la tasa BCV del día del pago.
        </p>
      </>
    ),
  },
  {
    id: "pagar",
    icon: "💳",
    title: "Cómo pagar mi condominio",
    content: (
      <>
        <p className="text-sm">El sistema NO procesa pagos directamente — vos pagás externamente y después notificás.</p>
        <ol className="list-decimal pl-5 space-y-1 mt-2 text-sm">
          <li>Mirá los datos bancarios al final del recibo PDF (cuenta Banesco, RIF, número de cuenta).</li>
          <li>Hacé la transferencia desde tu banco con el método que prefieras: <strong>Transferencia bancaria, Zelle, Pago Móvil, Cripto, Efectivo USD</strong>.</li>
          <li>Incluí el <strong>N° de recibo</strong> en el concepto/referencia para que la administración lo identifique.</li>
          <li>Guardá el comprobante (captura, PDF o foto).</li>
          <li>Notificá el pago en el portal (siguiente sección).</li>
        </ol>
      </>
    ),
  },
  {
    id: "notificar",
    icon: "📨",
    title: "Cómo notificar un pago",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Andá a la pestaña <strong>Notificar Pago</strong>.</li>
          <li>Elegí el método (Zelle, Pago Móvil, Transferencia, etc.).</li>
          <li>Ingresá el monto, la fecha y la referencia bancaria.</li>
          <li>Subí el comprobante (captura o PDF).</li>
          <li>Marcá las facturas que querés cubrir con ese pago.</li>
          <li>Enviá.</li>
        </ol>
        <p className="mt-2 text-sm">
          ✅ Una vez la administración valida el pago lo verás aplicado en tu estado de cuenta. Recibirás email de confirmación.
        </p>
        <p className="mt-2 text-sm">
          💰 Si pagaste de más, ese excedente se queda como <strong>Anticipo disponible</strong> y se descuenta automáticamente del próximo recibo.
        </p>
      </>
    ),
  },
  {
    id: "comprobante",
    icon: "🧾",
    title: "Cómo descargar mi comprobante de pago (bauche)",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Andá a la pestaña <strong>Principal</strong> o <strong>Pagos</strong>.</li>
          <li>Buscá el pago que querés.</li>
          <li>Hacé clic en <strong>Descargar comprobante</strong>.</li>
          <li>Se descarga un PDF firmado por la Junta de Condominio con tu pago y las facturas que cubrió.</li>
        </ol>
      </>
    ),
  },
  {
    id: "visitas",
    icon: "👋",
    title: "Cómo registrar una visita o invitado",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Andá a la pestaña <strong>Seguridad</strong>.</li>
          <li>Pulsá <strong>Registrar nuevo visitante</strong>.</li>
          <li>Llená: nombre completo, cédula (opcional), placa del vehículo si aplica.</li>
          <li>Definí desde cuándo y hasta cuándo se le permite el ingreso.</li>
          <li>Pulsá <strong>Generar QR</strong>.</li>
          <li>Compartí el QR con tu visitante por WhatsApp.</li>
          <li>Al llegar, el vigilante escanea el QR y le permite el acceso.</li>
        </ol>
      </>
    ),
  },
  {
    id: "reservas",
    icon: "🏊",
    title: "Cómo reservar áreas comunes",
    content: (
      <>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Andá a la pestaña <strong>Reservas</strong>.</li>
          <li>Elegí el área (salón de fiestas, piscina, parrilla, etc.).</li>
          <li>Seleccioná fecha y franja horaria.</li>
          <li>Confirmá.</li>
          <li>El sistema valida que no haya choque con otra reserva.</li>
        </ol>
        <p className="mt-2 text-sm">
          ⚠️ Si el área tiene costo o requiere depósito, lo verás antes de confirmar.
        </p>
      </>
    ),
  },
  {
    id: "deuda-general",
    icon: "📊",
    title: "Deuda general del condominio",
    content: (
      <>
        <p className="text-sm">
          En la pestaña <strong>Deuda General</strong> ves cuánto debe el condominio en total
          y cuántos meses tiene vencidos cada apartamento. Por privacidad, NO se muestran nombres
          de propietarios — solo el número de apartamento y el monto.
        </p>
        <p className="mt-2 text-sm">
          Esta vista es para transparencia: te ayuda a saber qué tan saludable está la cobranza
          de tu edificio.
        </p>
      </>
    ),
  },
  {
    id: "estado",
    icon: "💼",
    title: "Mi estado de cuenta",
    content: (
      <>
        <p className="text-sm">
          En <strong>Principal</strong> ves tu situación al día:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2 text-sm">
          <li>Deuda pendiente en USD y Bs (al cambio del día).</li>
          <li>Anticipo a favor (si pagaste de más).</li>
          <li>Último recibo emitido y último pago registrado.</li>
          <li>Gráfico de pagos de los últimos meses.</li>
        </ul>
      </>
    ),
  },
  {
    id: "whatsapp",
    icon: "💬",
    title: "Bot de WhatsApp (próximamente)",
    content: (
      <>
        <p className="text-sm">
          Pronto vas a poder consultarle tu deuda, pedir recibos y notificar pagos directamente
          por WhatsApp. Te avisaremos cuando esté disponible.
        </p>
        <p className="mt-2 text-sm">
          Por eso es importante que tengas tu número de WhatsApp actualizado en tu perfil.
        </p>
      </>
    ),
  },
  {
    id: "soporte",
    icon: "🆘",
    title: "Necesito ayuda — ¿a quién contacto?",
    content: (
      <>
        <p className="text-sm">
          Para cualquier problema, dudas o reporte de error:
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2 text-sm">
          <li>Email de la Junta de Condominio: <strong>(ver pie del recibo PDF)</strong></li>
          <li>Email para conciliación de pagos: <strong>soportecobranzascastanosb2021@gmail.com</strong> (Castaños)</li>
          <li>Soporte técnico de la plataforma: contactá a tu administrador del edificio.</li>
        </ul>
      </>
    ),
  },
];

export default function PortalHelpPage() {
  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <div className="bg-[#1e3a5f] text-white py-6">
        <div className="mx-auto max-w-3xl px-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs uppercase tracking-wider">Portal del residente</p>
            <h1 className="text-2xl font-bold">📖 Manual de uso</h1>
          </div>
          <Link
            href="/portal"
            className="rounded bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm transition-colors"
          >
            ← Volver al portal
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-3">
        <div className="rounded-xl bg-white border border-blue-100 p-4 text-sm">
          <p className="font-medium text-[#1e3a5f]">📌 Índice rápido</p>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="text-blue-700 hover:underline">
                {s.icon} {s.title}
              </a>
            ))}
          </div>
        </div>

        {SECTIONS.map((s) => (
          <div
            key={s.id}
            id={s.id}
            className="rounded-xl bg-white border border-slate-200 p-5 scroll-mt-20"
          >
            <h2 className="text-lg font-semibold text-[#1e3a5f] flex items-center gap-2">
              <span className="text-2xl">{s.icon}</span>
              {s.title}
            </h2>
            <div className="mt-3 prose prose-sm max-w-none text-slate-700">
              {s.content}
            </div>
          </div>
        ))}

        <div className="text-center py-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} ResidIA · Manual del residente · Versión 1.0
        </div>
      </div>
    </div>
  );
}
