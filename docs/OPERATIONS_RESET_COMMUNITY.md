# 🔄 Reset de comunidad — Manual de operación

> **Para qué sirve:** dejar una comunidad lista para un demo o ejercicio en vivo con el cliente, conservando la estructura (unidades, alícuotas) pero limpiando todo el historial financiero y operativo.
>
> **Caso de uso real (ejecutado):** Reset de **Los Arrayanes** el 8 de mayo de 2026 — el cliente (Reinaldo) pidió "solo dejes la información que te pasé" porque iban a hacer "el proceso completo de un mes" en vivo el sábado.

---

## 📋 Qué hace el endpoint `/api/admin/reset-arrayanes`

### En orden:

1. **Valida** que el usuario tiene `CRON_SECRET` (timing-safe)
2. **Confirma** que se quiere ejecutar (sin `confirm` corre en dry-run y solo reporta)
3. **Localiza** la comunidad por nombre (busca "Arrayanes")
4. **Verifica** que los 188 códigos del Excel mapean a unidades existentes (aborta si falta alguno)
5. **WIPE** — borra en orden FK-safe:
   - `PaymentAllocation` → `InvoiceItem` → `Payment` → `Invoice`
   - `BankAccount`, `UnidentifiedPayment`
   - `WorkOrderActivity`, `WorkOrderPayment`, `WorkOrder`
   - `Violation`, `AccessLog`, `Visitor`, `SecurityNote`
   - `Notification`, `Announcement`, `Reservation`, `CommonArea`
   - `AssemblyVote`, `AssemblyAgendaItem`, `Assembly`
   - `BoardMember`, `CommunityDocument`
   - `Income`, `RecurringExpenseTemplate`, `Expense`
   - `BudgetItem`, `Budget`, `MonthClose`
   - `Tenancy`, `Ownership` (de las unidades de esta comunidad)
   - `Vehicle` (de la org)
   - `Person` (de la org, excepto las que tienen `userId` ≠ null)
6. **RECREATE** — para cada fila del Excel:
   - Crea Persons (uno por dueño; las co-propiedades crean varios)
   - Crea Ownerships con `sharePercent` igual entre co-propietarios
   - Si la unidad debe algo (`pendUsd > 0`), crea una factura `EXTRA_FEE` "SALDO ANTERIOR" con la deuda exacta + un `InvoiceItem`

### Lo que NO toca:

- ❌ La comunidad misma (`Community`)
- ❌ Las unidades (`Unit`) — se preservan códigos, alícuotas, torres, pisos
- ❌ La organización (`Organization`)
- ❌ Las membresías (`Membership`) — los admins siguen activos
- ❌ Los usuarios con `userId` (cuentas reales del sistema)

---

## 🚀 Cómo ejecutarlo

### Paso 1 — Dry run (verificar mapeo)

```bash
curl -X POST https://residia.vercel.app/api/admin/reset-arrayanes \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Respuesta esperada (éxito):**
```json
{
  "community": { "id": "...", "name": "Los Arrayanes...", "organizationId": "..." },
  "dryRun": true,
  "summary": {
    "excelRows": 188,
    "unitsMatched": 188,
    "unitsMissing": [],
    "invoicesPlanned": 187,
    "totalDebtUsd": "18411.88"
  },
  "steps": [{ "step": "DRY_RUN_OK", "details": { ... } }]
}
```

⚠️ Si `unitsMissing` no está vacío, **STOP** — corregir el mapeo de códigos antes de ejecutar.

### Paso 2 — Ejecutar de verdad

```bash
curl -X POST https://residia.vercel.app/api/admin/reset-arrayanes \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"RESET-ARRAYANES"}'
```

**Respuesta esperada:**
```json
{
  "dryRun": false,
  "steps": [
    { "step": "WIPE", "details": { "payments": 12, "invoices": 188, ... } },
    { "step": "RECREATE", "details": {
        "persons": 201, "ownerships": 201, "invoices": 187, "invoiceItems": 187
    }}
  ],
  "summary": { "totalDebtUsd": "18411.88", ... }
}
```

### Paso 3 — Verificar en la app

1. Login a residia.vercel.app
2. Ir a Los Arrayanes → Estado de cuenta
3. Comprobar:
   - Los 188 propietarios aparecen con sus nombres del Excel
   - Cada unidad con deuda muestra una factura "SALDO-{código}" con el monto exacto
   - Suma total de deuda visible en Reportes = $18,411.88

---

## 🔧 Cómo adaptarlo para OTRA comunidad

El endpoint actual está hard-codeado para Los Arrayanes. Para reutilizarlo en otra comunidad:

1. **Generar el JSON de mapeo** desde el Excel del cliente:
   ```js
   // Script local: read-and-map.cjs
   const XLSX = require("xlsx");
   const wb = XLSX.readFile("ruta-al-excel.xls");
   // ... (ver `arrayanes-data.ts` como ejemplo)
   ```

2. **Ajustar la función de mapeo de código** según la nomenclatura del cliente.
   Ejemplo (Los Arrayanes): `"A011" → "A-01A"`. Cada cliente puede tener formatos distintos.

3. **Crear un nuevo endpoint** `/api/admin/reset-{cliente}/route.ts` clonando este,
   con su propio archivo `{cliente}-data.ts`.

4. **Validar primero con dry-run** antes de ejecutar.

---

## ⚠️ Postmortem — Por qué falló la primera carga (Los Arrayanes, mayo 2026)

**Problema reportado por cliente:**
> "no pasaste a las deudas como estaban en el archivo"

**Causa raíz (descubierta durante la auditoría):**
La nomenclatura del Excel del cliente (`A011`, `A012`, `APH1`) NO coincidía con la nomenclatura del sistema. **Y para complicarlo más, la nomenclatura del sistema NO coincidía con la documentada en `CLAUDE.md`.**

| Capa | Formato | Ejemplo |
|---|---|---|
| Excel del cliente | `{Tower}{Floor:2}{Apt:1}` | `A011`, `A234`, `APH1` |
| `CLAUDE.md` (incorrecto) | `{Tower}-{Floor:2}{Letter}` | `A-01A`, `A-23D`, `A-24PH1` |
| **Sistema real (BD)** | `{Floor}{Apt}{Tower}` | `11A`, `234A`, `PH1A` |

La importación original probablemente:
- Falló silenciosamente al no encontrar matches
- O cargó las deudas a unidades equivocadas

**Solución aplicada:**
1. Mapeo explícito código-Excel → código-sistema con función pura
   ```ts
   function excelToSystem(code: string): string {
     if (code.includes("PH")) {
       return `PH${code.replace(/^[AB]PH/, "")}${code[0]}`; // APH1 → PH1A
     }
     const tower = code[0];
     const floor = parseInt(code.substring(1, 3));
     const apt = code[3];
     return `${floor}${apt}${tower}`; // A011 → 11A
   }
   ```
2. Endpoint con dry-run obligatorio que ABORTA si algún código no mapea
3. **Diagnostic mode** que devuelve los códigos reales del sistema para comparar
4. Suma total de deudas validada contra el Excel ($18,411.88) — coincide exactamente
5. Parser de nombres robusto con varios separadores (`" - "`, `" -"`, `"- "`, `"-"`)

**Resultado del reset (8 mayo 2026):**
- WIPE: 191 invoices, 12 payments, 199 ownerships, 197 persons, 567 invoiceItems, etc.
- RECREATE: 202 persons (13 unidades multi-owner), 202 ownerships, 188 invoices, 188 items
- Total deuda inicial: **$18,411.88** ✅ exacto al Excel

**Lección para futuros clientes:**
Antes de cargar datos, **siempre confirmar la nomenclatura** con el cliente. Si difiere de la del sistema:
- Opción A: re-codificar las unidades del sistema para que coincidan
- Opción B: tener una capa de mapeo (como se hizo aquí)
- Opción C: pedir al cliente que adapte su archivo

Documentar el mapeo en este archivo cuando aplique.

---

## 📅 Histórico de ejecuciones

| Fecha | Cliente | Comunidad | Resultado | Notas |
|---|---|---|---|---|
| 2026-05-08 | Reinaldo (Los Arrayanes) | Los Arrayanes | ✅ OK | 188 unidades, $18,411.88 deuda inicial. Demo programado para sábado 11 de mayo. |

---

## 💵 Carga de SALDOS reales (migración desde sistema viejo) — 2026-06-21

Operación distinta al reset: **NO toca** unidades, propietarios ni plantillas — solo reemplaza el snapshot financiero por la **deuda real** del sistema anterior.

- **Endpoint one-shot:** `/api/admin/load-arrayanes-saldos` (dry-run con GET, ejecuta con POST + `confirm`). Borrado tras usar.
- **Fuente:** reporte **"DEUDA A LA FECHA"** exportado de Sisconin (deuda exacta por apartamento). **NO reconstruir** el saldo desde recibos+pagos — no cuadra (la cuota lleva fondo de reserva + mora por unidad). Pedir siempre el reporte de deuda actual del sistema viejo.
- **Qué hace:** borra `PaymentAllocation→InvoiceItem→Payment→Invoice` de la comunidad y crea 1 factura `EXTRA_FEE "SISCONIN-{code}"` (OVERDUE) por deudor con su deuda exacta. Validado contra apts que el admin confirme solventes (su pago = la cuota).
- **Resultado Arrayanes:** 117 deudores, $15.137,95. Mapeo Excel→ResidIA: A011→11A, APH1→PH1A, B163→163B.
- **Pagos:** ResidIA aplica FIFO (más vieja primero). El "Saldo Sisconin" es la más vieja → se cobra antes que los meses nuevos que emita el admin de aquí en adelante.
- **Emails:** se cargan aparte (solo guardar, sin enviar) los de alta confianza; envío masivo SOLO tras verificar con el admin.

---

**Mantenedor:** Innova
**Última actualización:** 2026-06-21
