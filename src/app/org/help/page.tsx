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
    summary: "Genera los recibos de condominio para todos los propietarios usando el asistente de emisión.",
    steps: [
      {
        step: 1,
        title: "Registra los gastos del mes (si aplica)",
        description: "Antes de emitir, asegúrate de haber cargado todos los gastos comunes del mes en Finanzas → Gastos Comunes. El sistema también incluye automáticamente la cuota mensual configurada del edificio.",
        tip: "Si solo usas cuota fija mensual y no hay gastos variables, puedes saltarte este paso.",
      },
      {
        step: 2,
        title: "Ir a Finanzas → Recibos y abrir el asistente",
        description: "Haz click en '✨ Emitir recibos'. Se abre el asistente de 3 pasos. El Paso 1 muestra el resumen de gastos del período y el total a distribuir.",
      },
      {
        step: 3,
        title: "Revisa la distribución estimada (Paso 2 del asistente)",
        description: "El sistema calcula cuánto le corresponde a cada unidad según su alícuota. La suma de todos los recibos siempre es exactamente igual al total de gastos (sin centavos perdidos, usando el método Hamilton).",
      },
      {
        step: 4,
        title: "Elige el modo de emisión (Paso 3 del asistente)",
        description: "Tienes dos opciones: '📋 Preparar borrador' crea los recibos en estado BORRADOR para que los revises antes de publicar. '⚡ Emitir ahora' los publica directamente como EMITIDOS.",
        tip: "Recomendamos 'Preparar borrador' cuando hay muchas unidades, así puedes revisar los montos antes de que los propietarios los vean.",
      },
      {
        step: 5,
        title: "Si elegiste borrador: publicar cuando estés listo",
        description: "En la página de Recibos aparecerá un banner amarillo indicando cuántos borradores hay. Haz click en '🚀 Publicar ahora' para cambiar todos al estado EMITIDO y que sean visibles para los propietarios.",
        tip: "Mientras los recibos estén en BORRADOR, los propietarios no los ven y no aparecen como deudores en el sistema. Solo al publicar se activa la deuda.",
      },
    ],
  },
  {
    id: "emails",
    icon: "📧",
    title: "Envío masivo de recibos por correo",
    summary: "Envía los recibos a todos los propietarios en lotes, con control total del proceso.",
    steps: [
      {
        step: 1,
        title: "Publica los recibos primero",
        description: "Los correos solo se pueden enviar cuando los recibos están en estado EMITIDO (no BORRADOR). Si ves el banner amarillo en Recibos, primero haz click en '🚀 Publicar ahora'.",
      },
      {
        step: 2,
        title: "Revisa el panel de estado de correos",
        description: "Una vez publicados, aparece el panel '📧 Estado de envío de correos' en la parte inferior de la página de Recibos. Muestra: total de recibos, cuántos correos se enviaron, fallidos y pendientes.",
      },
      {
        step: 3,
        title: "Click en '📤 Enviar lote (hasta 40)'",
        description: "El sistema envía hasta 40 correos de una vez. Cada correo incluye el detalle del recibo (monto en USD y BsS, desglose de gastos, fecha de vencimiento) y el link al portal personal del propietario.",
        tip: "Si tienes más de 40 unidades, haz click varias veces hasta que el contador de pendientes llegue a 0. El sistema recuerda a quiénes ya les envió y no repite.",
      },
      {
        step: 4,
        title: "Gestiona los correos fallidos",
        description: "Si algún propietario no tiene correo registrado o hay un error de envío, queda marcado como 'Fallido'. Ve a Propietarios, edita la persona para agregarle el correo, y luego vuelve a enviar el lote.",
        tip: "El sistema nunca envía dos veces al mismo propietario para el mismo período. Si corrigiste el email y quieres reenviar, anula el registro fallido desde la BD o contacta al soporte.",
      },
      {
        step: 5,
        title: "Envío automático nocturno (opcional)",
        description: "Si tienes configurado el cron de Vercel, el sistema también envía automáticamente los correos pendientes cada día a medianoche, en lotes de 40. El proceso manual y el automático no se pisan — ambos respetan quién ya recibió su correo.",
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
        description: "Entra al banco en línea y descarga el estado de cuenta. El sistema acepta: CSV/TXT (texto separado por comas, punto y coma o tabulaciones), Excel (.xlsx / .xls), y formato bancario OFX/QFX.",
        tip: "Bancos como Mercantil, Provincial, Banesco y Facebank ofrecen exportación CSV o Excel desde la banca en línea.",
      },
      {
        step: 2,
        title: "Ir a Finanzas → Conciliación",
        description: "En el menú lateral del edificio, bajo la sección Finanzas, encontrarás 'Conciliación'.",
      },
      {
        step: 3,
        title: "Arrastra o selecciona el archivo",
        description: "El sistema detecta automáticamente el formato del archivo (CSV, Excel u OFX), identifica las columnas de fecha, referencia y monto, y muestra el formato reconocido con un badge de color.",
        tip: "Si el sistema no detecta las columnas, verifica que el archivo tenga encabezados con palabras como 'fecha', 'monto', 'referencia' o 'descripción'. Para OFX/QFX no se necesita configuración.",
      },
      {
        step: 4,
        title: "Revisa los resultados en las tres tablas",
        description: "Verás tres secciones: (1) Movimientos bancarios conciliados ✅ — ya están en el sistema, (2) Movimientos sin conciliar ⚠️ — están en el banco pero no en el sistema, (3) Pagos en sistema no encontrados en banco — posibles pagos en efectivo o errores de referencia.",
      },
      {
        step: 5,
        title: "Registra los pagos faltantes",
        description: "Para cada movimiento sin conciliar, ve a Finanzas → Pagos y registra el pago con el monto y referencia que aparece en el estado bancario. Al volver a la conciliación, ese movimiento pasará a verde.",
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
    q: "Los propietarios aparecen como 'Solvente' aunque acabo de emitir los recibos. ¿Por qué?",
    a: "Esto sucede cuando los recibos están en estado BORRADOR (no publicados). El sistema no registra deuda hasta que los recibos estén EMITIDOS. Ve a Finanzas → Recibos, busca el banner amarillo y haz click en '🚀 Publicar ahora'. Luego los propietarios aparecerán como deudores en la página de Propietarios.",
  },
  {
    q: "¿Cuál es la diferencia entre 'Preparar borrador' y 'Emitir ahora'?",
    a: "'Preparar borrador' crea los recibos en estado BORRADOR: están guardados pero invisibles para los propietarios, no generan deuda y no se envían correos. Debes publicarlos manualmente cuando estés listo. 'Emitir ahora' los crea directamente como EMITIDOS: la deuda es visible de inmediato y puedes proceder a enviar los correos.",
  },
  {
    q: "¿Cómo envío los correos a 188 propietarios sin que se caiga el sistema?",
    a: "Ve a Finanzas → Recibos → panel '📧 Estado de envío'. Haz click en '📤 Enviar lote (hasta 40)' para enviar de a 40 correos. Repite el proceso hasta que el contador de pendientes llegue a 0. El sistema recuerda a quiénes ya envió y nunca duplica. También puedes dejar que el cron automático lo envíe de noche.",
  },
  {
    q: "¿Qué pasa si un propietario no tiene correo electrónico?",
    a: "El recibo se emite normalmente y queda disponible en el sistema. El propietario aparecerá como 'Fallido' en el panel de correos. Puedes agregarle el correo en Propietarios → editar, y luego volver a intentar el envío. También puedes compartir el link del portal manualmente por WhatsApp.",
  },
  {
    q: "¿Los correos se envían automáticamente o debo hacerlo manualmente?",
    a: "Ambas opciones están disponibles. El cron nocturno envía automáticamente los correos pendientes cada día (hasta 40 por ejecución). Si quieres enviarlos de inmediato — por ejemplo, al inicio de mes — usa el botón '📤 Enviar lote' en la página de Recibos. Los dos métodos se coordinan: no se duplican envíos.",
  },
  {
    q: "¿Puedo cambiar la cuota mensual de una unidad específica?",
    a: "Sí. Ve a la página de la unidad (Unidades → Ver unidad), luego edita los datos. Puedes ajustar la 'cuota extra mensual' que se suma a lo que corresponde por alícuota. La alícuota base se configura en porcentaje.",
  },
  {
    q: "¿Cómo funciona la tasa de cambio?",
    a: "El sistema consulta automáticamente la tasa BCV cada día a las 8 AM. Puedes actualizarla manualmente desde Finanzas → General → botón 'Actualizar tasa BCV'. Cada transacción guarda la tasa del momento exacto en que se registró.",
  },
  {
    q: "¿Puedo anular un pago registrado por error?",
    a: "Sí. Ve a Finanzas → Pagos, busca el pago y usa el botón de anular. El sistema pide una razón y guarda un registro de auditoría. El pago no se borra, queda marcado como anulado y la factura regresa a pendiente.",
  },
  {
    q: "¿Qué es la alícuota?",
    a: "Es el porcentaje de los gastos comunes que le corresponde a cada unidad. Según la Ley de Propiedad Horizontal venezolana, se calcula en base al área de cada apartamento sobre el área total del edificio. La suma de todas las alícuotas debe ser exactamente 100%.",
  },
  {
    q: "¿Los recibos se generan automáticamente cada mes?",
    a: "El sistema prepara borradores automáticamente el día 1 de cada mes (si hay cron configurado). Los borradores quedan en espera de tu revisión y publicación. Una vez que haces click en 'Publicar', los recibos pasan a EMITIDO y los correos se envían en el mismo día.",
  },
  {
    q: "¿Qué formatos acepta la conciliación bancaria?",
    a: "El módulo de conciliación acepta: CSV y TXT (con separadores por coma, punto y coma o tabulación), Excel (.xlsx y .xls), y OFX/QFX (formato bancario estándar usado por bancos internacionales). El formato se detecta automáticamente al subir el archivo.",
  },
  {
    q: "¿Cómo importo los datos de mis propietarios?",
    a: "Ve a Importar datos en el menú lateral. Puedes descargar la plantilla CSV, llenarla con los datos y subirla. El sistema acepta importaciones de unidades, propietarios, pagos históricos, gastos, vehículos, contratistas y presupuesto anual.",
  },
  {
    q: "¿Puedo ver cuánto le debe cada propietario?",
    a: "Sí. Finanzas → Estado de Cuenta muestra el aging de cartera completo: qué unidades deben a 30, 60, 90 o más días. También en Reportes tienes un panel de 'Top deudores' con barra visual de la deuda relativa de cada uno.",
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
