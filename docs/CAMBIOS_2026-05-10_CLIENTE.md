# Cambios solicitados por el cliente — 10/05/2026

> Rama: `claude/fix-currency-rate-recording-b0sQ8`
> Commits: `6381beb` (Tanda 1) · `7023a78` (Tanda 2 + #10/#13)

---

## Lista original de 13 puntos

1. Las deudas son para el mes 4
2. Los gastos y los pagos se están registrando con la tasa de la fecha que se hace el registro, lo correcto es que se registre con la tasa del día de pago
3. Los recibos deben visualizarse antes de emitir. Accidentalmente los emití
4. No se debería poder registrar más gastos después de emitido el recibo
5. ¿Cuál es la función de las plantillas recurrentes?
6. ¿Cómo se trabaja cuando se están haciendo provisiones de gastos?
7. La referencia en los pagos por transferencia debe ser obligatoria
8. El recibo debe mostrar el monto de lo aplicado en cada mes
9. En caso de que el pago sea mayor a la deuda se debe emitir un recibo de saldo a favor
10. La conciliación presenta inconsistencia
11. Al realizar el pago si se tiene deuda se debe aplicar automáticamente al mes más antiguo
12. ¿Cómo anular recibo por errores después de registrar?
13. Hay discrepancia entre los Bs y los dólares asignado

---

## Resumen ejecutivo

| # | Tipo | Estado |
|---|---|---|
| 1 | Contexto del cliente (data cargada del mes 04) | Sin acción de código |
| 2 | Bug — tasa | ✅ Corregido |
| 3 | UX — preview | ✅ Mejorado |
| 4 | Validación | ✅ Implementado |
| 5 | Pregunta | 📖 Documentado abajo |
| 6 | Pregunta | 📖 Documentado abajo |
| 7 | Validación | ✅ Implementado |
| 8 | Bug — display | ✅ Corregido |
| 9 | Feature | ✅ Implementado |
| 10 | Bug — conciliación | ✅ Corregido |
| 11 | Comportamiento | ✅ Implementado |
| 12 | Feature | ✅ Implementado |
| 13 | Bug — Bs/USD | ✅ Corregido (era el mismo de #10) |

---

## Detalle por punto

### #1 — "Las deudas son para el mes 4"

Era contexto, no un bug a corregir: el cliente cargó data fechada en abril/2026 para hacer pruebas. No se requirió ningún cambio. Cuando vea valores asociados al período 04/2026 en pruebas, es ese conjunto de datos.

---

### #2 — Tasa de cambio según la fecha del hecho económico ✅

**Antes:** los gastos, ingresos y pagos guardaban la tasa BCV del **día en que el admin los registraba** en el sistema. Si se cargaba un pago retroactivo al sistema una semana después, la tasa era la actual, no la del día real.

**Ahora:**
- `registerExpense` toma la tasa de `receiptDate` (fecha del comprobante).
- `registerIncome` toma la tasa de `receivedAt` (nuevo parámetro, default: hoy).
- `recordPayment` ya usaba `paidAt` — pero `getCurrentRate(source, paidAt)` tenía un sub-bug: cuando no había tasa cacheada para la fecha pasada, llamaba al API externo (que solo devuelve la tasa del día) y la guardaba como si fuera la tasa de la fecha histórica, distorsionando el dato. **Solución:** para fechas pasadas ya no se llama al API externo; se busca la tasa BCV/MANUAL más cercana **anterior o igual** a la fecha y se usa esa.

**Archivos:** `src/server/services/exchange.ts`, `invoicing.ts`, `income.ts`, `payments.ts`.

---

### #3 — Vista previa real antes de emitir ✅

**Antes:** el wizard de emisión mostraba solo 20 unidades como muestra y un cálculo aproximado por alícuota × total. Era fácil llegar al botón "Emitir ahora" sin haber visto los recibos finales reales.

**Ahora:** `previewMonth` replica exactamente el cálculo de `issueMonthlyInvoices`:
- Gastos individuales (van a una unidad target)
- Gastos por torre (prorrateo solo entre unidades de la torre)
- Gastos generales (prorrateo entre todas las unidades)
- Descuento por ingresos marcados como `affectsInvoice=true`
- Cuota mensual configurada del condominio

El paso 2 del wizard lista **TODAS las unidades** con torre, alícuota, número de líneas y total exacto en USD/Bs. El paso 3 muestra el gran total y bloquea "Emitir ahora" si el período ya tiene recibos sin anular.

**Archivos:** `src/server/trpc/routers/finance.ts` (`previewMonth`), `src/app/org/communities/[id]/finance/invoices/page.tsx`.

---

### #4 — Bloqueo de gastos después de emitido el recibo ✅

**Antes:** se podía registrar gastos comunes para un período aún después de haber emitido los recibos. Esos gastos quedaban "atascados" porque `issueMonthlyInvoices` rechaza re-emisión.

**Ahora:** `registerExpense` lanza `CONFLICT` si el período ya tiene facturas sin anular y el gasto no es individual. Mensaje:

> Ya se emitieron facturas para 04/2026. No se pueden añadir gastos comunes a un período cerrado. Marca el gasto como individual o anula las facturas para re-emitirlas.

Los gastos `isIndividual=true` siguen aceptándose porque tienen el flujo `expenses.issueDirectCharge` (cargo directo a la unidad post-emisión).

**Archivos:** `src/server/services/invoicing.ts`.

---

### #5 — ¿Para qué sirven las plantillas recurrentes? 📖

**Modelo:** `RecurringExpenseTemplate` (un registro por gasto recurrente del condominio).

**Ubicación UI:** Finanzas → Gastos → tab **"Plantillas recurrentes"**.

**Función:** automatizar el alta de gastos que se repiten todos los meses con el mismo concepto y monto aproximado en USD (luz común, agua, conserje, jardinería, internet, etc.). Cada plantilla guarda:

| Campo | Descripción |
|---|---|
| `category` | ELECTRICITY, WATER, GAS, INTERNET, etc. |
| `customCategory` | Etiqueta libre cuando categoría = OTHER |
| `description` | "Luz comunes torre A" |
| `supplierName` | "Corpoelec" |
| `amountUsd` | Monto de referencia (ej. 80) |
| `towerScope` | null=general, "A", "B"=por torre |
| `active` | Sí / No |

**Flujo de uso:**
1. El admin crea las plantillas una sola vez (por ejemplo: Luz $80, Agua $40, Conserje $250).
2. El primer día del mes el admin entra a Gastos → Plantillas recurrentes y pulsa **"Aplicar al mes"**.
3. El sistema crea automáticamente un `Expense` para cada plantilla activa, con el período actual y el monto USD de referencia. La tasa se toma del día.
4. El admin solo edita los gastos que tuvieron variación (ej. "Luz pasó de $80 a $87").

Esto reduce el alta mensual de ~10 gastos a 1 click + ajustes.

---

### #6 — ¿Cómo se trabaja con provisiones de gastos? 📖

**Concepto contable:** una provisión es un gasto que se reconoce ANTES de pagarse en efectivo, para distribuir su impacto a lo largo del año en lugar de cargarlo todo en el mes en que se paga (ej. utilidades de personal en diciembre, pintura general bianual, reparación de fachada).

**Cómo se maneja en el sistema:**

**Opción A — Categoría `RESERVE_FUND` (fondo de reserva genérico):**
- Cada mes registrar un gasto con categoría `RESERVE_FUND` por la cuota mensual de la provisión.
- Ejemplo: pintura proyectada en $2,400 a 12 meses → registrar $200/mes con descripción "Provisión pintura fachada 2026".
- Estos $200 se prorratean entre las unidades como cualquier gasto común.
- Cuando la pintura efectivamente se hace, se registra el desembolso real con categoría `REPAIRS` y nota indicando que se cubre con la reserva acumulada.

**Opción B — Plantilla recurrente (recomendada para provisiones permanentes):**
- Crear una plantilla recurrente con categoría `RESERVE_FUND`, descripción descriptiva ("Provisión pintura"), `amountUsd` = cuota mensual.
- Aplicar al mes con un click cada vez que se inicia un período.
- Ventaja: el monto es estable y aparece automáticamente.

**Importante:**
- El sistema NO tiene actualmente una entidad "Provision" separada con saldo acumulado y desembolsos contra ella. Se opera contablemente vía gastos `RESERVE_FUND` y la diferencia entre lo provisionado y lo gastado real se ve en los reportes y en la cuenta bancaria.
- Si en el futuro se requiere trazabilidad fina (saldo de cada provisión, desembolsos contra ella, ajustes), eso es una nueva fase. Mientras tanto, la convención `RESERVE_FUND + descripción consistente` cubre el caso operativo.

---

### #7 — Referencia obligatoria en pagos bancarios ✅

**Antes:** la referencia era opcional para todos los métodos de pago.

**Ahora:** es **obligatoria** (validación en backend + frontend) cuando el método es:

- `TRANSFER_BSS` (Transferencia Bs)
- `TRANSFER_USD` (Transferencia USD)
- `ZELLE`
- `PAGO_MOVIL` (Pago Móvil)
- `CHECK` (Cheque)

Sigue opcional para `CASH_BSS`, `CASH_USD`, `CRYPTO`, `OTHER`.

En el formulario aparece un asterisco rojo `*` junto a la etiqueta y el HTML `required` impide enviar si está vacía. El backend además valida y devuelve error explícito.

**Archivos:** `src/server/services/payments.ts`, `src/app/org/communities/[id]/finance/payments/page.tsx`.

---

### #8 — Recibo muestra el monto aplicado, no el monto total del pago ✅

**Bug encontrado:** la sección "ABONOS REGISTRADOS EN ESTE RECIBO" del PDF mostraba `payment.amountUsd` (el monto **total** del pago, antes de repartirse). Si un pago de $100 se asignaba como $30 abril + $70 mayo, ambos recibos mostraban la fila "$100", confundiendo al residente.

**Fix:** ahora cada fila muestra `paymentAllocation.amountUsd` (la asignación específica al recibo en cuestión). El recibo de abril dice "$30", el de mayo "$70".

**Archivos:** `src/server/trpc/routers/finance.ts` (`invoices.downloadPdf`).

---

### #9 — Saldo a favor (anticipo) ✅

**Antes:** si un pago superaba la deuda, la diferencia quedaba como "anticipo" sin allocations, pero no había KPI ni botón para verlo o aplicarlo. El admin tenía que descubrirlo navegando al detalle de pagos de la unidad.

**Ahora:**
- `unitBalance` retorna `creditUsd` y `creditBss` (saldo a favor real = pagos no asignados a ninguna factura, sumados con cap a no-negativo).
- Estado de cuenta del propietario muestra un banner ámbar:
  > 💰 Saldo a favor: $X.XX USD (Bs Y reales)
  > Pagos recibidos de esta unidad sin asignar a recibos.
- Si la unidad tiene deuda pendiente, aparece el botón **"✨ Aplicar a recibos pendientes"** que llama a la nueva mutación `finance.applyUnitCredit`. Esta:
  - Recorre las facturas pendientes (`ISSUED/PARTIAL/OVERDUE`) ordenadas por `dueDate ASC` (más antigua primero).
  - Consume el crédito creando `PaymentAllocation` proporcionalmente entre los pagos con anticipo.
  - Recalcula `paidBss/paidUsd/status` de cada factura cubierta.
  - Audita la operación.

Si la unidad no tiene deudas, el saldo permanece como anticipo para recibos futuros (botón aplica solo cuando hay algo a lo que asignarlo).

**Archivos:** `src/server/trpc/routers/finance.ts` (`unitBalance`, `applyUnitCredit`), `src/app/org/communities/[id]/finance/account/page.tsx`.

---

### #10 + #13 — Conciliación e inconsistencia Bs/USD ✅

Estos dos puntos eran la **misma raíz**: la conciliación trabajaba con tasas inconsistentes.

**Bug:**
- El extracto bancario muestra Bs reales que se movieron en cada transacción.
- Los pagos en el sistema guardan `amountUsd`, `amountBss` y la `exchangeRate` del día del pago (tasa **histórica**).
- La conciliación tomaba `bank.monto` (Bs) y lo dividía por la **tasa de hoy** para compararlo con `payment.amountUsd`. La columna "Diferencia" usaba la misma fórmula.
- Si la tasa BCV cambiaba entre la fecha del pago y la fecha en que se cargaba el extracto (cosa que pasa todos los días en Venezuela), el match fallaba o mostraba un diff falso. Este es el "discrepancia entre Bs y USD" que reportó el cliente.

**Ejemplo concreto:**
- Pago registrado el 03/04 con tasa BCV 100: amountUsd=100, amountBss=10.000.
- Extracto cargado el 10/05: el banco muestra 10.000 Bs.
- Tasa BCV del 10/05: 105.
- Conciliación vieja: 10.000 / 105 = $95,24 vs $100 → diff $4,76 falso.
- Conciliación nueva: 10.000 Bs (banco) vs 10.000 Bs (pago) → ✓ exacto.

**Fix:**
- `listForReconciliation` expone `amountBss`, `exchangeRate` y `currencyPrimary` del pago.
- El motor de matching compara directamente `bank.monto` (Bs) contra `payment.amountBss` (Bs) — misma unidad, sin conversión.
- Tolerancia: máximo entre **1 Bs** y **0,5%** del monto (cubre redondeos del banco y comisiones IGTF de céntimos).
- La columna "Diferencia" muestra `|bank.monto - payment.amountBss|` en Bs.
- El display del pago en la tabla usa `payment.amountBss` (real histórico) en vez de `payment.amountUsd × tasa de hoy` (proyección distorsionada).

**Archivos:** `src/server/trpc/routers/finance.ts` (`listForReconciliation`), `src/app/org/communities/[id]/finance/conciliacion/page.tsx`.

---

### #11 — Aplicación automática al recibo más antiguo ✅

**Antes:** si se registraba un pago sin allocations explícitas, todo el monto quedaba como anticipo. El admin tenía que ir factura por factura asignándolo manualmente.

**Ahora:** `recordPayment` con `allocations` vacío o ausente y `autoAllocate=true` (default):
- Busca todas las facturas pendientes de la unidad (`ISSUED/PARTIAL/OVERDUE`) ordenadas por `dueDate ASC`.
- Aplica el monto del pago de la más antigua a la más reciente, hasta agotarlo.
- El sobrante (si excede toda la deuda) queda como anticipo / saldo a favor (ver #9).

Para forzar el comportamiento anterior (todo como anticipo), pasar `autoAllocate=false` o allocations explícitas.

**Archivos:** `src/server/services/payments.ts`.

---

### #12 — Anular recibo emitido por error ✅

**Antes:** la mutación `finance.invoices.voidOne` existía pero no había botón en la UI. Solo accesible vía tRPC directo.

**Ahora:** botón **"🗑️ Anular"** por fila en `/finance/invoices`:
- Pide motivo (mínimo 3 caracteres) en un prompt.
- Confirma con un dialog explicando que el recibo no se elimina pero queda marcado como ANULADO en auditoría.
- Si el recibo tenía pagos aplicados, esos pagos quedan como anticipo (las allocations se preservan, pero al estar el invoice en estado VOIDED, el balance se libera).
- Refresca la lista y el aging tras anular.

Notas:
- Recibos en estado `VOIDED` no muestran el botón.
- Acción auditada (`AuditAction.INVOICE_VOIDED`).
- No re-libera los `Expense` enlazados (su `invoicedAt` queda seteado). Si se anula TODO un período y se quiere re-emitir con los mismos gastos, hay que limpiar `expense.invoicedAt` manualmente en BD por ahora — es un mejora futura.

**Archivos:** `src/app/org/communities/[id]/finance/invoices/page.tsx`.

---

## Archivos modificados

```
src/server/services/exchange.ts                                 (#2)
src/server/services/invoicing.ts                                (#2, #4)
src/server/services/income.ts                                   (#2)
src/server/services/payments.ts                                 (#2, #7, #11)
src/server/trpc/routers/finance.ts                              (#3, #8, #9, #10/#13)
src/app/org/communities/[id]/finance/payments/page.tsx          (#7)
src/app/org/communities/[id]/finance/invoices/page.tsx          (#3, #12)
src/app/org/communities/[id]/finance/account/page.tsx           (#9)
src/app/org/communities/[id]/finance/conciliacion/page.tsx      (#10/#13)
```

Sin cambios de schema Prisma — no se requiere migración.

---

## Verificación

```
$ pnpm typecheck
✓ tsc --noEmit (sin errores)

$ pnpm test
✓ tests/unit/money.test.ts        (17 tests)
✓ tests/unit/proration.test.ts    (9 tests)
✓ tests/unit/invoicing.test.ts    (6 tests)
Test Files  3 passed · Tests  32 passed
```

---

## Cómo ver los cambios en local

### Pre-requisitos (única vez)

1. **Docker Desktop** corriendo (para Postgres + Redis + MinIO).
2. **Node 22+** y **pnpm** instalados.
3. Clon del repo y archivo `.env` con las variables de `.env.example` (DATABASE_URL apuntando a Postgres local en `localhost:5435`).

### Pasos

```bash
# 1. Traer la rama con los cambios
git fetch origin claude/fix-currency-rate-recording-b0sQ8
git checkout claude/fix-currency-rate-recording-b0sQ8

# 2. Levantar Postgres / Redis / MinIO
docker compose up -d

# 3. Instalar dependencias (si cambió package.json o es la primera vez)
pnpm install

# 4. (Solo primera vez) Aplicar schema Prisma a la BD local
pnpm db:migrate

# 5. (Solo primera vez) Cargar datos de prueba
pnpm db:seed

# 6. Levantar la app
pnpm dev
```

La app queda en **http://localhost:3010** (puerto definido en `package.json:scripts.dev`).

### Qué probar

| Funcionalidad | Ruta |
|---|---|
| #2, #11 — registrar pago con fecha pasada y ver tasa correcta + auto-asignación | `/org/communities/[id]/finance/payments` |
| #3 — wizard con preview real | `/org/communities/[id]/finance/invoices` → "✨ Emitir recibos" |
| #4 — intentar registrar gasto en período ya emitido | `/org/communities/[id]/finance/expenses` |
| #5 — plantillas recurrentes | `/org/communities/[id]/finance/expenses` → tab "Plantillas recurrentes" |
| #7 — referencia obligatoria en transferencia | formulario de pago, cambiar método a TRANSFER_USD |
| #8 — PDF del recibo con monto aplicado correcto | `/org/communities/[id]/finance/invoices` → 📄 PDF de un recibo con pagos parciales |
| #9 — saldo a favor | `/org/communities/[id]/finance/account` → seleccionar unidad con sobrepago |
| #10 + #13 — conciliación con tasa histórica | `/org/communities/[id]/finance/conciliacion` → cargar extracto |
| #12 — anular recibo | `/org/communities/[id]/finance/invoices` → 🗑️ Anular |

### Datos de prueba para validar #10 + #13

Para reproducir el bug original y verificar que está corregido, hacen falta:
1. Un pago registrado con tasa **distinta** a la actual (paidAt en una fecha donde la tasa BCV era diferente).
2. Cargar un extracto bancario que contenga la línea correspondiente en Bs reales.

Si la BD local no tiene ese escenario, el camino más rápido es:
- Registrar un pago con `paidAt` retroactivo de hace 1 mes y método `TRANSFER_BSS`.
- En la BD, abrir el registro `Payment` y verificar `amountBss`.
- Crear un CSV mínimo con esa misma cifra Bs y la misma referencia.
- Subir el CSV en `/finance/conciliacion` y verificar que el match es exacto y la diferencia muestra "✓".

### Notas

- **No se requiere migración Prisma**: los cambios son puramente de lógica y UI sobre el schema existente.
- Si la BD local fue seedeada hace mucho y los pagos viejos tienen `amountBss` calculado con tasas erróneas (consecuencia del bug histórico de #2), la conciliación nueva los matcheará correctamente con el extracto que se generó al mismo tiempo, pero el USD asociado se verá distinto del que se registraría hoy. Esa es la realidad financiera de los registros viejos — no hay forma de corregirlos retroactivamente sin re-importar.
