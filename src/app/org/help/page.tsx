"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GuideStep {
  step: number;
  title: string;
  description: string;
  tip?: string;
}

interface Guide {
  id: string;
  icon: string;
  title: string;
  summary: string;
  steps: GuideStep[];
}

interface FAQ {
  q: string;
  a: string;
}

// ─── Content ──────────────────────────────────────────────────────────────────
const GUIDES: Guide[] = [
  {
    id: "gastos",
    icon: "📋",
    title: "Registrar gastos comunes",
    summary: "Registra los gastos del mes antes de emitir los recibos.",
    steps: [
      {
        step: 1,
        title: "Ir a Finanzas → Gastos Comunes",
        description: "En el menú lateral del edificio, haz click en 'Gastos Comunes' bajo la sección Finanzas.",
      },
      {
        step: 2,
        title: "Click en 'Agregar gasto'",
        description: "Aparece un formulario donde ingresas la descripción, categoría, monto en USD y la fecha.",
        tip: "Si el gasto es en bolívares, el sistema lo convierte automáticamente usando la tasa BCV del día.",
      },
      {
        step: 3,
        title: "Selecciona la categoría",
        description: "Usa las categorías predefinidas (electricidad, agua, mantenimiento, seguridad, etc.) o elige 'Otro' y escribe una etiqueta personalizada.",
      },
      {
        step: 4,
        title: "Guarda el gasto",
        description: "El gasto queda en estado 'Pendiente'. Cuando emitas los recibos del mes, se distribuirá automáticamente entre todas las unidades según su alícuota.",
      },
    ],
  },
  {
    id: "recibos",
    icon: "📄",
    title: "Emitir recibos mensuales",
    summary: "Genera y envía los recibos de condominio a todos los propietarios.",
    steps: [
      {
        step: 1,
        title: "Ir a Finanzas → Recibos",
        description: "Aquí verás el historial de recibos emitidos y el botón para generar los del mes actual.",
      },
      {
        step: 2,
        title: "Click en 'Emitir ahora'",
        description: "Se abre el asistente de 3 pasos. Primero te muestra los gastos del período.",
        tip: "Si no hay gastos registrados, el sistema igualmente puede emitir recibos con la cuota base configurada.",
      },
      {
        step: 3,
        title: "Revisa la distribución por unidad",
        description: "El paso 2 muestra cómo se distribuye el total entre cada unidad según su porcentaje de alícuota. La suma siempre da el total exacto (sin centavos perdidos).",
      },
      {
        step: 4,
        title: "Elige preparar borrador o emitir",
        description: "'Preparar borrador' crea los recibos sin enviarlos — puedes revisar antes. 'Emitir ahora' los publica de inmediato y programa el envío de correos.",
        tip: "Los correos se envían automáticamente a razón de 40 por día, con 5 segundos entre cada uno, comenzando al día siguiente a las 8 AM.",
      },
    ],
  },
  {
    id: "pagos",
    icon: "💳",
    title: "Registrar pagos",
    summary: "Registra los pagos de los propietarios en el sistema.",
    steps: [
      {
        step: 1,
        title: "Ir a Finanzas → Pagos",
        description: "Verás la lista de todos los pagos registrados con su estado.",
      },
      {
        step: 2,
        title: "Click en 'Registrar pago'",
        description: "Selecciona la unidad (propietario), el monto en USD, el método de pago y la referencia bancaria.",
        tip: "Métodos disponibles: transferencia, efectivo USD, Zelle, Pago Móvil. El sistema acepta pagos parciales.",
      },
      {
        step: 3,
        title: "El sistema asigna automáticamente",
        description: "El pago se aplica primero a la factura más antigua pendiente (FIFO). Si el pago cubre más de una factura, se distribuye en orden.",
      },
      {
        step: 4,
        title: "Notificación automática",
        description: "Al registrar el pago, se envía automáticamente una notificación in-app y por correo al propietario confirmando el recibo.",
      },
    ],
  },
  {
    id: "cierre",
    icon: "🔒",
    title: "Cierre de mes",
    summary: "Cierra el mes contable para fijar las cifras del período.",
    steps: [
      {
        step: 1,
        title: "Ir a Finanzas → General",
        description: "Baja hasta la sección 'Cierre de mes' al final de la página.",
      },
      {
        step: 2,
        title: "Click en 'Cerrar mes'",
        description: "Aparece un modal donde seleccionas el año y mes a cerrar.",
        tip: "El cierre es solo un registro contable — no bloquea edición de datos. Sirve para auditoría y comparar períodos.",
      },
      {
        step: 3,
        title: "Agrega notas opcionales",
        description: "Puedes escribir observaciones del período (ej. 'Mes con reparación de bomba de agua, gasto extraordinario $500').",
      },
      {
        step: 4,
        title: "Confirma el cierre",
        description: "El sistema guarda un snapshot de: total gastos, total facturado, total cobrado, número de facturas/pagos y porcentaje de cobranza del mes.",
      },
    ],
  },
  {
    id: "conciliacion",
    icon: "🏦",
    title: "Conciliación bancaria",
    summary: "Verifica que los pagos registrados coincidan con tu estado de cuenta bancario.",
    steps: [
      {
        step: 1,
        title: "Descarga el estado de cuenta de tu banco",
        description: "Entra al banco en línea y descarga el estado de cuenta en formato CSV o TXT. Casi todos los bancos venezolanos ofrecen esta opción.",
        tip: "Bancos como Mercantil, Provincial, Banesco ofrecen exportación CSV desde la banca en línea.",
      },
      {
        step: 2,
        title: "Ir a Finanzas → Conciliación",
        description: "En el menú lateral, bajo la sección Finanzas, encontrarás 'Conciliación'.",
      },
      {
        step: 3,
        title: "Arrastra o selecciona el archivo",
        description: "El sistema detecta automáticamente las columnas (fecha, referencia, monto). No necesitas configuración.",
      },
      {
        step: 4,
        title: "Revisa los resultados",
        description: "Verás qué movimientos del banco ya están registrados en el sistema (✅) y cuáles no (⚠️). Los sin conciliar pueden ser pagos aún no registrados.",
      },
    ],
  },
  {
    id: "portal",
    icon: "🏠",
    title: "Portal del propietario",
    summary: "Cómo los propietarios acceden a ver sus facturas y notificar pagos.",
    steps: [
      {
        step: 1,
        title: "El propietario recibe un link por correo",
        description: "Cuando se emite un recibo, el sistema envía un correo con un link único y seguro al portal. No se necesita usuario ni contraseña.",
      },
      {
        step: 2,
        title: "Ver estado de cuenta",
        description: "Al entrar al portal, el propietario ve sus facturas (pagadas y pendientes), su balance total y el estado de cuenta del condominio del mes.",
      },
      {
        step: 3,
        title: "Notificar un pago",
        description: "El propietario puede ir a la pestaña 'Notificar Pago', ingresar el monto, método, referencia y comprobante. El pago queda en espera de confirmación del administrador.",
        tip: "El link del portal dura 30 días. Si vence, el administrador puede reenviar el correo desde la página de Recibos.",
      },
    ],
  },
];

const FAQS: FAQ[] = [
  {
    q: "¿Qué pasa si un propietario no tiene correo electrónico?",
    a: "El sistema sigue funcionando. El recibo se emite normalmente y queda disponible en el sistema. Puedes compartir el link del portal manualmente por WhatsApp o imprimirle el recibo desde la página de Recibos.",
  },
  {
    q: "¿Puedo cambiar la cuota mensual de una unidad específica?",
    a: "Sí. Ve a la página de la unidad (Unidades → Ver unidad), luego edita los datos. Puedes ajustar la 'cuota extra mensual' que se suma a lo que corresponde por alícuota. La alícuota base se configura en porcentaje.",
  },
  {
    q: "¿Cómo funciona la tasa de cambio?",
    a: "El sistema consulta automáticamente la tasa BCV cada día a las 8 AM. Puedes actualizarla manualmente desde Finanzas → General → botón 'Actualizar tasa BCV'. Cada transacción guarda la tasa del momento exacto.",
  },
  {
    q: "¿Puedo anular un pago registrado por error?",
    a: "Sí. Ve a Finanzas → Pagos, busca el pago y usa el botón de anular. El sistema pide una razón y guarda un registro de auditoría. El pago no se borra, queda marcado como anulado.",
  },
  {
    q: "¿Qué es la alícuota?",
    a: "Es el porcentaje de los gastos comunes que le corresponde a cada unidad. Según la Ley de Propiedad Horizontal venezolana, se calcula en base al área de cada apartamento sobre el área total del edificio. La suma de todas las alícuotas debe ser exactamente 100%.",
  },
  {
    q: "¿Los recibos se generan automáticamente cada mes?",
    a: "El sistema puede preparar borradores automáticamente los días 1-5 de cada mes. Los borradores esperan tu revisión y aprobación antes de enviarse a los propietarios. Puedes configurar si quieres que se auto-emitan o solo se preparen como borrador.",
  },
  {
    q: "¿Cómo importo los datos de mis propietarios?",
    a: "Ve a Importar datos en el menú lateral. Puedes descargar la plantilla Excel, llenarla con los datos y subirla. El sistema acepta importaciones de unidades, propietarios, pagos históricos, gastos y más.",
  },
  {
    q: "¿Puedo ver cuánto le debe cada propietario?",
    a: "Sí. Finanzas → Estado de Cuenta muestra el aging de cartera completo: qué unidades deben a 30, 60, 90 o más días. También en Reportes tienes un panel de 'Top deudores'.",
  },
];

// ─── Components ───────────────────────────────────────────────────────────────
function GuideCard({ guide, onSelect }: { guide: Guide; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(guide.id)}
      className="w-full text-left rounded-xl border border-slate-700 bg-slate-800/60 p-5 hover:border-blue-600/50 hover:bg-slate-800 transition-all group"
    >
      <div className="text-3xl mb-3">{guide.icon}</div>
      <h3 className="font-semibold text-white group-hover:text-blue-300 transition-colors">{guide.title}</h3>
      <p className="text-sm text-slate-400 mt-1">{guide.summary}</p>
      <p className="text-xs text-blue-400 mt-3 flex items-center gap-1">
        Ver guía paso a paso <span>→</span>
      </p>
    </button>
  );
}

function GuideDetail({ guide, onBack }: { guide: Guide; onBack: () => void }) {
  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm mb-6"
      >
        ← Volver a guías
      </button>

      <div className="flex items-center gap-3 mb-6">
        <span className="text-4xl">{guide.icon}</span>
        <div>
          <h2 className="text-xl font-bold text-white">{guide.title}</h2>
          <p className="text-slate-400 text-sm">{guide.summary}</p>
        </div>
      </div>

      <div className="space-y-4">
        {guide.steps.map((step) => (
          <div key={step.step} className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold text-white">
                {step.step}
              </div>
            </div>
            <div className="flex-1 pb-4 border-b border-slate-800 last:border-0">
              <h4 className="font-medium text-white mb-1">{step.title}</h4>
              <p className="text-sm text-slate-400">{step.description}</p>
              {step.tip && (
                <div className="mt-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-300">
                  💡 {step.tip}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FAQItem({ faq }: { faq: FAQ }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left py-4 flex items-start justify-between gap-4 hover:text-white transition-colors"
      >
        <span className="text-sm font-medium text-slate-200">{faq.q}</span>
        <span className={`text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="pb-4 text-sm text-slate-400 leading-relaxed">
          {faq.a}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HelpPage() {
  const [selectedGuide, setSelectedGuide] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"guias" | "faq">("guias");

  const guide = GUIDES.find(g => g.id === selectedGuide);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center py-6">
        <div className="text-5xl mb-3">🎓</div>
        <h1 className="text-2xl font-bold text-white">Centro de Ayuda</h1>
        <p className="text-slate-400 mt-2">
          Todo lo que necesitas saber para administrar tu condominio
        </p>
      </div>

      {/* Search suggestion */}
      <div className="rounded-xl bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/20 p-4 flex items-center gap-4">
        <span className="text-2xl">💬</span>
        <div>
          <p className="text-sm font-medium text-white">¿No encuentras lo que buscas?</p>
          <p className="text-xs text-slate-400">Escríbele a tu administrador de plataforma o revisa las guías paso a paso abajo.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 pb-0">
        {(["guias", "faq"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelectedGuide(null); }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab === "guias" ? "📚 Guías paso a paso" : "❓ Preguntas frecuentes"}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "guias" && (
        <div>
          {guide ? (
            <Card className="bg-slate-900 border-slate-700">
              <CardContent className="pt-6">
                <GuideDetail guide={guide} onBack={() => setSelectedGuide(null)} />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GUIDES.map(g => (
                <GuideCard key={g.id} guide={g} onSelect={setSelectedGuide} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "faq" && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-base text-white">Preguntas frecuentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              {FAQS.map((faq, i) => (
                <FAQItem key={i} faq={faq} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick reference */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-base text-white">⚡ Acciones rápidas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { icon: "📋", label: "Registrar gasto", path: "finance/expenses" },
              { icon: "📄", label: "Emitir recibos", path: "finance/invoices" },
              { icon: "💳", label: "Registrar pago", path: "finance/payments" },
              { icon: "🏦", label: "Conciliar banco", path: "finance/conciliacion" },
              { icon: "🔒", label: "Cerrar mes", path: "finance" },
              { icon: "📊", label: "Ver estado de cuenta", path: "finance/account" },
            ].map(item => (
              <div
                key={item.path}
                className="flex items-center gap-3 rounded-lg bg-slate-800 border border-slate-700 p-3"
              >
                <span className="text-xl">{item.icon}</span>
                <span className="text-sm text-slate-300">{item.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Navega al edificio correspondiente en el menú lateral para acceder a estas funciones.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
