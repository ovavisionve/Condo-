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

  // ── NUEVAS GUÍAS (mayo 2026) ─────────────────────────────────────
  {
    id: "provisiones",
    icon: "📊",
    title: "Provisiones y Ajuste mes anterior",
    summary: "Modelo contable estándar para gastos variables (Hidrocapital, Luz, etc.): cobras una estimación fija mensual y se ajusta el mes siguiente con la diferencia real.",
    steps: [
      {
        step: 1,
        title: "Entender el concepto",
        description: "La provisión es un monto FIJO que se cobra cada mes como estimado del gasto (ej. Hidrocapital Bs 20.000). El AJUSTE PROVISIÓN MES ANTERIOR es la diferencia entre lo que se gastó realmente y lo que se provisionó.",
        tip: "Ejemplo: provisión Bs 20k, real Bs 25k → mes siguiente cobras 20k de provisión + 5k de ajuste. Si real Bs 18k → cobras 20k − 2k = crédito a favor del residente.",
      },
      {
        step: 2,
        title: "Crear la plantilla recurrente",
        description: "Ve a Finanzas → Gastos → tab Plantillas Recurrentes → '+ Nueva plantilla'. Llená nombre, monto fijo en Bs o USD, alcance (general/torre) y Marca el checkbox '📊 Tratar como provisión'.",
        tip: "Las plantillas con isProvision activan el modelo de provisión + ajuste. Sin ese check, simplemente cobra el monto fijo cada mes sin ajustes.",
      },
      {
        step: 3,
        title: "Aplicar plantillas al mes",
        description: "Al inicio de cada mes, aprieta '⚡ Aplicar plantillas recurrentes'. El sistema crea automáticamente la línea 'Provisión X' del mes + calcula el AJUSTE del mes anterior basado en gastos reales registrados.",
      },
      {
        step: 4,
        title: "Registrar gastos reales vinculados",
        description: "Durante el mes, cuando llegue la factura real (ej. Hidrocapital Bs 25.000), registra el gasto. En el formulario, en la caja ÁMBAR '📊 ¿Es el gasto real de alguna provisión?', Selecciona la plantilla correspondiente. Este gasto NO se factura al residente — solo sirve para calcular el ajuste el mes siguiente.",
        tip: "Si no vinculas el gasto real a la plantilla, el sistema no podrá calcular el ajuste y el residente seguirá pagando solo la provisión sin reflejar el real.",
      },
      {
        step: 5,
        title: "Verificar en el preview",
        description: "Aprieta el botón flotante 📄 (esquina inferior izquierda) y selecciona el mes. Vas a ver 2 líneas separadas por cada plantilla isProvision: 'Provisión X' (mes actual) y 'Ajuste Provisión X — mes anterior' (con la diferencia).",
      },
    ],
  },
  {
    id: "fondo-reserva",
    icon: "🏦",
    title: "Fondo de Reserva automático al 10%",
    summary: "El sistema calcula automáticamente el 10% del subtotal de gastos comunes y lo agrega como línea en cada recibo, igual que tu Aviso de Cobro tradicional.",
    steps: [
      {
        step: 1,
        title: "Configuración por defecto",
        description: "Todos los condominios arrancan con reserveFundPct = 0.10 (10%). Este es el estándar venezolano según práctica de la mayoría de condominios.",
      },
      {
        step: 2,
        title: "Funcionamiento automático",
        description: "Cuando emites el recibo del mes, el sistema suma todos los gastos comunes prorrateados (sin contar Cuota mensual ni descuentos) y agrega una línea 'Fondo de Reserva (10%)' al final de la sección GASTOS COMUNES.",
        tip: "El recibo muestra: SUBTOTAL GASTOS COMUNES → Fondo de Reserva (10%) → TOTAL GASTOS COMUNES, igual que el Aviso de Cobro tradicional venezolano.",
      },
      {
        step: 3,
        title: "Anti-doble-cobro",
        description: "Si ya tienes una plantilla 'Fondo de Reserva' cargada manualmente como gasto, el sistema detecta que ya existe un Expense con category=RESERVE_FUND y NO duplica. Respeta tu monto manual.",
        tip: "Recomendación: si vas a usar el cálculo automático, desactivá o elimina la plantilla manual de Fondo de Reserva.",
      },
      {
        step: 4,
        title: "Ver el saldo acumulado del edificio",
        description: "Al final del recibo aparece un bloque 'FONDO DE RESERVA (ACUMULADO DEL CONDOMINIO)' con el saldo anterior + aporte del mes + total acumulado del edificio entero (no de la unidad).",
      },
    ],
  },
  {
    id: "cierre-mes",
    icon: "🔒",
    title: "Cierre de mes",
    summary: "Bloquea modificaciones de gastos e ingresos de un mes ya facturado para garantizar integridad contable.",
    steps: [
      {
        step: 1,
        title: "Cuándo cerrar el mes",
        description: "Una vez emitidos todos los recibos del mes y registrados todos los gastos reales vinculados a provisiones, ve a Finanzas → General → card '🔒 Cierre de mes' y aprieta '🔒 Cerrar [Mes] [Año]'.",
      },
      {
        step: 2,
        title: "Qué se bloquea al cerrar",
        description: "No se podrán crear ni editar gastos ni ingresos en ese mes. Si intentas, el sistema lanza error 'El mes X/Y está cerrado. Reabrelo para registrar...'.",
        tip: "Excepción: los gastos vinculados a plantilla de provisión SÍ se pueden registrar aunque el mes esté cerrado, porque no se facturan al residente — solo sirven para el ajuste del mes siguiente.",
      },
      {
        step: 3,
        title: "Reabrir si es necesario",
        description: "Si necesitas corregir algo, ve al mismo card y aprieta '🔓 Reabrir mes'. El sistema pide confirmación y deja un audit log de la reapertura.",
      },
      {
        step: 4,
        title: "Historial de cierres",
        description: "El card muestra un historial scrollable con: período cerrado, fecha de cierre, % de cobranza del mes, y botón para reabrir cada uno.",
      },
    ],
  },
  {
    id: "preview-recibo",
    icon: "📄",
    title: "Previsualizar el recibo (botón flotante)",
    summary: "Botón 📄 permanente en la esquina inferior izquierda que muestra el PDF del recibo del mes en formato real, como lo verá el residente.",
    steps: [
      {
        step: 1,
        title: "Acceder al preview",
        description: "El botón verde con ícono 📄 aparece en cualquier pantalla del panel admin, en la esquina inferior izquierda. Aprieta para abrir.",
      },
      {
        step: 2,
        title: "Seleccionar mes y unidad",
        description: "En la sidebar elige el mes y año + busca la unidad. El PDF se carga automáticamente. Puedes cambiar de unidad y ver cómo varía el recibo según la alícuota.",
      },
      {
        step: 3,
        title: "Ver en grande",
        description: "Click en '🔍 Ver en grande' para abrir el PDF en modal fullscreen y leer todos los detalles cómodamente.",
      },
      {
        step: 4,
        title: "Actualizaciones en vivo",
        description: "El preview se actualiza automáticamente cuando: creas/editas/eliminas un gasto, una plantilla, un ingreso, o cuando cierras/reabres el mes.",
        tip: "Si no se ve un cambio reciente, recarga con Ctrl+Shift+R (recarga sin caché).",
      },
      {
        step: 5,
        title: "Proyección automática",
        description: "El preview proyecta automáticamente las plantillas activas no aplicadas todavía + el AJUSTE PROVISION del mes anterior. Es decir, puedes ver cómo se verá el recibo sin necesidad de apretar 'Aplicar plantillas' primero.",
      },
    ],
  },
  {
    id: "conciliacion",
    icon: "🏦",
    title: "Conciliación bancaria",
    summary: "Subí el estado de cuenta del banco (CSV/Excel/OFX) y el sistema cruza automáticamente cada movimiento con los pagos registrados.",
    steps: [
      {
        step: 1,
        title: "Descargar el estado de cuenta del banco",
        description: "Desde la web/app de tu banco (Banesco, Mercantil, Provincial, etc.), exportá el extracto del período en formato CSV, Excel o OFX.",
        tip: "Si quieres probar el flujo sin tener un extracto real, usa el link '🧪 Descargar CSV de prueba (mock Banesco)' que aparece en la página de Conciliación.",
      },
      {
        step: 2,
        title: "Subir el archivo",
        description: "Ve a Finanzas → Conciliación → 'Seleccionar archivo' o arrastrá el archivo. El sistema detecta automáticamente: formato, separador (coma/punto y coma/tab), fila de cabecera (los bancos VE meten título arriba) y celdas vacías.",
      },
      {
        step: 3,
        title: "Interpretar los matches",
        description: "Cada movimiento del extracto se marca con un badge: ✅ Conciliado (Ref exacta / parcial / monto), ⚠️ Pendiente (sin match), o etiqueta del tipo (TRF, Pago Móvil, Comisión, IGTF 3%, Depósito, etc.).",
      },
      {
        step: 4,
        title: "Procesar pendientes",
        description: "Para créditos pendientes (sin pago en el sistema), usa: 🏭 Registrar como gasto (comisiones), 📦 Aparcar como pago no identificado (para asignarlo después a una unidad), o ignorar.",
      },
      {
        step: 5,
        title: "Filtros y tabs",
        description: "Usa los tabs 'Todos / Conciliados / Sin conciliar / Débitos+Comis' para filtrar. KPIs arriba: total créditos, comisiones, neto disponible, % conciliado.",
      },
    ],
  },
  {
    id: "tasas-bcv",
    icon: "💱",
    title: "Tasa BCV automática + histórico",
    summary: "El sistema mantiene la tasa BCV actualizada y usa la tasa histórica correcta cuando registras pagos con fecha pasada.",
    steps: [
      {
        step: 1,
        title: "Actualización automática",
        description: "El cron de Vercel corre todos los días a las 6pm Caracas (22:00 UTC) y actualiza la tasa BCV automáticamente. Además, cuando un admin entra a cualquier pantalla de finanzas, si la tasa guardada no es de hoy, se dispara un refresh en background.",
      },
      {
        step: 2,
        title: "Refresh manual",
        description: "Si necesitas actualizar al instante: Finanzas → General → card 'Tasa BCV' → botón '🔄 Actualizar desde BCV'. El sistema consulta bcv.org.ve, dolarapi.com y pydolarve en orden y guarda la primera respuesta válida.",
      },
      {
        step: 3,
        title: "Tasa manual de respaldo",
        description: "Si todas las fuentes BCV están caídas, puedes cargar la tasa manualmente en la misma card. Marca la fuente como MANUAL en lugar de BCV.",
      },
      {
        step: 4,
        title: "Pagos con fecha histórica",
        description: "Al registrar un pago con fecha pasada (ej. el residente pagó el 15 de marzo), el sistema usa automáticamente la tasa BCV de ese día, no la de hoy. Hay 85+ tasas históricas cargadas desde enero 2026.",
        tip: "Esto evita errores de diferencial cambiario en pagos viejos. La conversión Bs↔USD usa siempre la tasa correcta del día del pago.",
      },
    ],
  },
  {
    id: "mantenimiento-torre",
    icon: "🏗️",
    title: "Mantenimiento con alcance por torre",
    summary: "Las órdenes de trabajo pueden afectar a todo el condominio, a una torre específica, o a una sola unidad.",
    steps: [
      {
        step: 1,
        title: "Crear nueva orden",
        description: "Ve a Mantenimiento → '+ Nueva orden de trabajo'. Llená título, descripción, categoría, prioridad.",
      },
      {
        step: 2,
        title: "Definir alcance",
        description: "En el selector 'Alcance' elige: 🏢 Todo el condominio (default), 🏗️ Solo Torre A, o 🏗️ Solo Torre B. Esto sirve para mantenimientos específicos por torre (ej. 'Limpieza de tanques Torre A').",
      },
      {
        step: 3,
        title: "Unidad específica (opcional)",
        description: "Si la orden afecta a UNA sola unidad (ej. 'Filtración en apto 84A'), selecciona la unidad en 'Unidad específica'. Eso deshabilita el selector de torre porque son mutuamente excluyentes.",
      },
      {
        step: 4,
        title: "Asignar contratista y seguimiento",
        description: "Una vez creada, asigna un contratista, cambiá el status (OPEN → ASSIGNED → IN_PROGRESS → COMPLETED), agrega notas durante el proceso, y registra pagos al contratista.",
      },
    ],
  },
  {
    id: "visitantes-portal",
    icon: "🔐",
    title: "Visitantes desde el portal del residente",
    summary: "Los residentes pueden solicitar la pre-autorización de sus visitantes desde el portal sin pasar por la administración.",
    steps: [
      {
        step: 1,
        title: "Residente accede al portal",
        description: "El residente entra a /portal con sus credenciales o link único. En el menú elige '🔐 Visitantes'.",
      },
      {
        step: 2,
        title: "Solicitar visitante",
        description: "Apreta '+ Solicitar visitante', llena nombre, cédula, teléfono, placa del vehículo (opcional), fecha desde/hasta y motivo. El visitante queda con status PENDING.",
      },
      {
        step: 3,
        title: "QR para el vigilante",
        description: "El sistema genera un accessCode único. Cuando el visitante llega al edificio, el vigilante ve la lista de pendientes en /security (con reloj real arriba), lo identifica y le da check-in con un click.",
      },
      {
        step: 4,
        title: "Check-in/out por el vigilante",
        description: "Al ingresar, el vigilante apreta '✓ Ingreso' (status → CHECKED_IN). Al salir, '↑ Salida' (status → CHECKED_OUT). Cada movimiento se registra con timestamp en el AccessLog.",
        tip: "Los visitantes PENDING aparecen primero con fondo ámbar destacado para que el vigilante los identifique de inmediato.",
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

  // ── FAQs nuevas (mayo 2026) ────────────────────────────────────
  {
    q: "¿Cómo funciona el Modelo A de provisiones (provisión + ajuste)?",
    a: "Cobras un monto FIJO estimado cada mes (provisión, ej. Bs 20.000 de Hidrocapital). Durante el mes registras los gastos REALES vinculados a la plantilla. El mes siguiente, al apretar 'Aplicar plantillas', el sistema calcula AUTOMÁTICAMENTE el AJUSTE = real − provisión y lo carga al recibo. Si gastaste más, se cobra la diferencia. Si gastaste menos, queda como crédito (negativo) al residente. Es el modelo estándar venezolano según LPH.",
  },
  {
    q: "Estoy registrando un gasto real de Hidrocapital. ¿Por qué tengo que vincularlo a la plantilla?",
    a: "Porque el sistema necesita saber que ese gasto NO se cobra al residente directamente (ya pagaron la provisión), sino que sirve para calcular el AJUSTE del mes siguiente. Si no vinculas, el sistema no sabe que es 'gasto contra provisión' y nunca calcula el ajuste. La caja ámbar '📊 ¿Es el gasto real de alguna provisión?' del formulario es exactamente para esto.",
  },
  {
    q: "Quité el check 'Tratar como provisión' de una plantilla. ¿Qué pasa?",
    a: "El sistema deja de comportar esa plantilla como provisión. Cobra el monto fijo cada mes sin generar ajustes mes siguiente. Los gastos REGULAR linked a esa plantilla pasan a facturarse normal al residente (en lugar de servir solo para ajuste).",
  },
  {
    q: "¿Por qué aparece 'Fondo de Reserva (10%)' automáticamente en el recibo?",
    a: "Es el estándar venezolano. El sistema calcula el 10% del subtotal de gastos comunes prorrateados y lo agrega como línea separada en el recibo. Si quieres cambiar el porcentaje, eso se hace por código (Community.reserveFundPct). Si ya tienes un Expense manual con category=RESERVE_FUND para el período, el sistema NO duplica — respeta tu monto manual.",
  },
  {
    q: "Cerré el mes y ahora no puedo agregar gastos. ¿Cómo destrabo?",
    a: "Ve a Finanzas → General → card '🔒 Cierre de mes' → selecciona el mes cerrado → aprieta '🔓 Reabrir mes'. El sistema te pide confirmación y deja un audit log. Después puedes modificar gastos/ingresos libremente.",
  },
  {
    q: "El preview del recibo no muestra el gasto que acabo de cargar. ¿Bug?",
    a: "Probablemente el cache del preview no se invalidó. Recarga con Ctrl+Shift+R (recarga sin caché). El preview se invalida automáticamente cuando creas/editas gastos, ingresos, plantillas y cuando cierras/reabres el mes. Si después de recargar sigue sin verse, verifica que el gasto tenga el período correcto (año/mes).",
  },
  {
    q: "¿Cómo registro un pago que el residente hizo hace 2 meses?",
    a: "En el formulario de Notificar/Registrar pago, simplemente selecciona la fecha pasada en 'Fecha del pago'. El sistema usa AUTOMÁTICAMENTE la tasa BCV histórica de ese día (tenemos 85+ tasas cargadas desde enero 2026), no la de hoy. Eso garantiza que la conversión Bs↔USD sea exacta y no haya distorsión de diferencial cambiario.",
  },
  {
    q: "Reinaldo (admin Arrayanes) registró provisiones en marzo pero no aparecen en abril.",
    a: "Si Reinaldo cargó plantillas isProvision y aplicó al mes en marzo, eso creó los PROVISION_BASE de marzo. Para que aparezca el AJUSTE en abril, debe (a) aplicar plantillas en abril también, lo que crea PROVISION_BASE abril + AJUSTE PROVISION marzo, OR (b) abrir el preview de abril — el sistema PROYECTA automáticamente la línea PROVISION + AJUSTE en el preview sin necesidad de apretar 'Aplicar al mes'.",
  },
  {
    q: "¿Por qué solo aparece 'Ajuste Provisión X' y no 'Provisión X' en el preview?",
    a: "Era un bug ya corregido (mayo 2026). El sistema colapsaba las 2 líneas en una sola por usar el mismo group key. Si todavía ves esto: recarga con Ctrl+Shift+R y vuelve a abrir el preview. Ahora cada plantilla isProvision muestra 2 líneas separadas: 'Provisión X' (mes actual) y 'Ajuste Provisión X — mes anterior'.",
  },
  {
    q: "¿Cómo asigno una orden de trabajo solo a la Torre A?",
    a: "En Mantenimiento → '+ Nueva orden' → selector 'Alcance' elige '🏗️ Solo Torre A'. La unidad específica queda deshabilitada (es para órdenes que afectan a UNA unidad). En el listado y detalle aparece el badge 🏗️ Torre A para identificarla.",
  },
  {
    q: "El residente Olga solicitó un visitante desde su portal. ¿Dónde lo veo?",
    a: "Ve a Seguridad → tab Visitantes. Los visitantes con status PENDING aparecen ARRIBA con fondo ámbar destacado. Cuando el visitante llegue al edificio, el vigilante lo identifica por nombre, apreta '✓ Ingreso' y queda con status CHECKED_IN. El sistema registra el timestamp exacto.",
  },
  {
    q: "¿Cómo configuro la conciliación bancaria si mi banco tiene un formato raro?",
    a: "El sistema detecta automáticamente el formato (CSV/Excel/OFX), el separador (coma/punto y coma/tab), y busca la fila de cabecera entre las primeras 10 filas (los bancos venezolanos suelen meter título + info de cuenta antes del header real). Si igual no detecta tu archivo, pegame una muestra y agrego soporte específico.",
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
