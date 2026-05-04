"use client";

import { Card, CardContent } from "@/components/ui/card";

export default function MarketingPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">🎯 Eventos de Marketing</h1>
        <p className="text-muted-foreground text-sm">Activaciones, ferias y eventos del centro comercial</p>
      </div>

      <div className="rounded-lg border-2 border-dashed border-blue-200 bg-blue-50/50 p-12 text-center space-y-3">
        <div className="text-4xl">🎯</div>
        <h2 className="text-lg font-semibold">Módulo de Marketing</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Aquí podrás planificar y registrar eventos, activaciones de marca, ferias, y campañas del centro comercial.
          Este módulo estará disponible próximamente.
        </p>
        <div className="flex flex-wrap gap-2 justify-center mt-4">
          {["Ferias navideñas", "Activaciones de marca", "Shows infantiles", "Campañas de temporada", "Patrocinios"].map(t => (
            <span key={t} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-2">🔜 Próximamente</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Calendario de eventos del mall</li>
            <li>Presupuesto vs ejecución de marketing</li>
            <li>Registro de sponsors por local</li>
            <li>Métricas de asistencia y conversión</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
