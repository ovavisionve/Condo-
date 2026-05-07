"use client";

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="max-w-md">
        {/* Icono */}
        <div className="text-7xl mb-6">📡</div>

        <h1 className="text-2xl font-bold text-slate-800 mb-3">
          Sin conexión a internet
        </h1>
        <p className="text-slate-500 mb-8">
          La app está en modo offline. Algunas funciones no están disponibles
          hasta que se restablezca la conexión.
        </p>

        {/* Qué SÍ funciona offline */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 text-left">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            ✅ Disponible sin internet
          </p>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>• Páginas visitadas recientemente (en caché)</li>
            <li>• Estado de cuenta y recibos ya cargados</li>
            <li>• Información del edificio y unidades</li>
            <li>• Datos de visitantes pre-autorizados</li>
          </ul>
        </div>

        <div className="bg-amber-50 rounded-xl border border-amber-200 p-5 mb-8 text-left">
          <p className="text-sm font-semibold text-amber-700 mb-3">
            ⏳ Requiere internet
          </p>
          <ul className="space-y-2 text-sm text-amber-600">
            <li>• Registrar pagos y nuevas transacciones</li>
            <li>• Emitir facturas</li>
            <li>• Tasa BCV del día</li>
          </ul>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full bg-slate-800 text-white py-3 rounded-xl font-medium hover:bg-slate-700 transition-colors"
        >
          🔄 Reintentar conexión
        </button>

        <p className="text-xs text-slate-400 mt-4">
          ResidIA — Modo sin conexión
        </p>
      </div>
    </div>
  );
}
