# 📋 Progreso de mejoras — Sesión 11 de mayo 2026

> **Estado:** EN CURSO. El cliente Reinaldo está probando hoy. Lista de mejoras post-demo en aplicación.

---

## ✅ Lo que YA está aplicado y desplegado en producción

### Tanda original (puntos 1-13 de Reinaldo, 10 may)
- #2 Tasa BCV por fecha real (endpoint `finance.exchange.byDate` + UI dinámica)
- #3 Wizard de emisión con preview completo (188 unidades)
- #4 Bloqueo gastos post-emisión
- #5 Plantillas recurrentes — documentado
- #6 Provisiones — implementadas con `isProvision`
- #7 Referencia obligatoria con asterisco rojo (5 métodos bancarios)
- #8 PDF con monto APLICADO (no total del pago)
- #9 Saldo a favor + botón Aplicar FIFO
- #10/#13 Conciliación Bs↔Bs directa
- #11 Auto-asignación FIFO con conversión VES→USD
- #12 Anular con motivo obligatorio (mín 3 chars) + ícono 🗑️
- Tasa histórica también en los 9 bulkImports

### Feedback noche del 10/may (todo aplicado)
- **Tasa de la fecha del pago**: header del modal muestra "cotización del DD/MM/YYYY" (la fecha de la tasa, no la del pago)
- **5000 Bs ya no se trata como USD**: "Suma asignada: Bs X", "Bs Y sin asignar" en moneda primaria
- **Plantillas agrupan**: 5 gastos de Ferretería = 1 línea "Provisión Ferretería" en el recibo
- **AJUSTE PROVISION MES ANTERIOR**: calculado automáticamente al aplicar plantilla `isProvision=true`
- **PDF estilo Arrayanes**: layout 4 columnas (Total Bs / Cuota USD / Cuota Bs), subtotales por sección con %
- **Fondo de Reserva** con saldo acumulado en PDF
- **Checkbox isProvision en UI** + badge ámbar + toggle rápido

### Hardening seguridad (8 may)
- Bloqueo cuenta 5 intentos / 15 min
- Recuperación contraseña con token 15 min
- Inactividad sesión 30 min + warning a los 25
- Security headers (CSP, HSTS, X-Frame-Options)
- IDOR fixes en ccLocal/byId, ccInvoice/void
- `timingSafeEqual` en todos los endpoints CRON/admin
- Rate limit password reset (3/hora)
- Trust host + secure cookies para Vercel

### Operacional
- Reset endpoint `/api/admin/reset-arrayanes` (idempotente)
- Aliases `residia.vercel.app` + `condominios-theta.vercel.app` configurados como Production Domains (auto-actualizan en cada deploy)
- BD Los Arrayanes con $18,411.88 exacto al Excel del cliente

### Validado E2E hoy en browser producción (11 may madrugada)
1. ✅ Plantilla normal "Servicios Generales" creada
2. ✅ Plantilla provisión "Mantenimiento Ascensores" con badge
3. ✅ Aplicar al mes 6 → crea PROVISION_BASE + REGULAR
4. ✅ Bloqueo "Ya se emitieron facturas para 06/2026..." funciona
5. ✅ Recibo julio muestra: línea "Provisión X $0.32" + línea "Ajuste Provisión X — mes anterior $-0.32" (negativa por crédito)
6. ✅ Modal pago: cambia fecha → tasa cambia ("cotización del 5/4/2026")
7. ✅ Pago 5000 Bs → "Suma asignada: Bs X" / "Bs Y sin asignar" (corrección del bug Reinaldo)
8. ✅ Auto-distribuir convierte 5000 Bs → $10.26 USD y aplica al SALDO-A011 más antiguo

### Bug encontrado y fixeado HOY
- `prorate: total no puede ser negativo` con ajustes provisión negativos → fix `prorateSigned()` en invoicing.ts (commit `dcbf860`, ya en prod)

---

## 🚧 En aplicación (commits hechos, deploy pendiente)

### Commits locales sin deployar
- `512c7f8` fix: applyToMonth no duplica plantillas regulares (era REGULAR, antes solo chequeaba PROVISION_BASE)
- `16e930d` feat: búsqueda rápida en unidades + endpoint `listPaginated`

---

## 📝 Lista de mejoras pendientes (las 14 que sugerí + extras)

### 🔥 Alto valor / poco esfuerzo
| # | Mejora | Estado |
|---|---|---|
| 1 | Pasarela de pago (Megasoft, Stripe VE, etc.) | ❌ DESCARTADO — requiere aliado comercial |
| 2 | Recordatorios escalonados WhatsApp | ❌ DESCARTADO — WhatsApp pagos no integrado por cliente |
| 3 | Bot WhatsApp residentes | ❌ DESCARTADO — idem |
| 4 | Dashboard ejecutivo con KPIs visuales | 🔵 Pendiente |

### 💎 Diferenciadores
| # | Mejora | Estado |
|---|---|---|
| 5 | Onboarding wizard 5 min | 🔵 Pendiente |
| 6 | Vista simplificada por rol (seguridad/mantenimiento) | 🔵 Pendiente |
| 7 | Plan de pago con morosos | 🔵 Pendiente — modelo `PaymentPlan` + endpoints + UI |
| 8 | Cartas legales Art. 14 LPH automáticas | 🔵 Pendiente — PDF + endpoint generateLegalNotice |
| 9 | Reservas con factura automática | 🔵 Pendiente |

### 🏗️ Deuda técnica
| # | Mejora | Estado |
|---|---|---|
| 10 | Prisma migrate deploy (CI) en lugar de endpoints one-shot | 🔵 Pendiente |
| 11 | Tests E2E Playwright (5 flujos críticos) | 🔵 Pendiente |
| 12 | Sentry observabilidad | 🔵 Pendiente |
| 13 | PR → preview → tests gates (GitHub Actions) | 🔵 Pendiente |
| 14 | i18n para vender fuera de Venezuela | 🔵 Pendiente — fase 2 |

### Mejorables encontrados en codebase
| Item | Estado |
|---|---|
| applyToMonth duplicados | ✅ Fixeado (`512c7f8`) |
| Errores genéricos del server al cliente | 🚧 Trabajando ahora |
| Rate limit per-user (solo password reset hoy) | 🔵 Pendiente |
| Progreso visible en bulkImport 500+ filas | 🔵 Pendiente |
| Paginación en listados grandes (188 unidades) | ✅ Búsqueda agregada (`16e930d`) |

### Mejoras visuales del PDF (mencionadas anteriormente, pendientes)
- Período en formato "Desde X hasta Y" explícito
- Bloque "TOTAL DEL MES" destacado al lado del logo en header
- "Total a Pagar" desglosado con cuotas previas pendientes

---

## 🛠️ Para retomar el trabajo

1. Estás en branch `master`
2. Último deploy producción: commit `dcbf860` (prorateSigned)
3. Commits locales sin deploy: `512c7f8`, `16e930d`
4. Para deployar todo: `vercel deploy --prod`
5. Alias `residia.vercel.app` y `condominios-theta.vercel.app` se actualizan automáticamente al deploy

### Credenciales operativas
- Login admin: `admin@condominios.local` / `admin1234`
- CRON_SECRET: `C:\Users\PCELL\condominios\.tmp-secret`
- Comunidad Los Arrayanes ID: `cmol08ry00004sth7q55ztv9a`
- Organización ID: `cmol08rw10000sth7og3ekxr8`

### Para resetear Los Arrayanes a estado virgen
```powershell
$secret = Get-Content "C:\Users\PCELL\condominios\.tmp-secret" -Raw
Invoke-RestMethod -Uri "https://residia.vercel.app/api/admin/reset-arrayanes" `
  -Method Post -Headers @{ Authorization = "Bearer $secret"; "Content-Type" = "application/json" } `
  -Body '{"confirm":"RESET-ARRAYANES"}'
```

---

**Última actualización:** 2026-05-11
