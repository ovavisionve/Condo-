# 🛡️ Biblia de Seguridad — ResidIA / Innova

> **Documento maestro de seguridad.** Este archivo documenta cada vulnerabilidad detectada en auditoría, cómo se resolvió, y los principios de seguridad que aplican a cualquier proyecto SaaS multi-tenant. Se mantiene actualizado proyecto a proyecto.

**Última auditoría:** 2026-05-07
**Plataforma auditada:** ResidIA (Next.js 14 + tRPC + Prisma + PostgreSQL/Supabase + NextAuth v5)
**Auditor:** Auditoría automatizada de 4 frentes (auth, APIs, validación, secrets)

---

## 📋 Índice

1. [Modelo de amenazas](#1-modelo-de-amenazas)
2. [Hallazgos críticos resueltos](#2-hallazgos-críticos-resueltos)
3. [Hallazgos medios resueltos](#3-hallazgos-medios-resueltos)
4. [Hallazgos pendientes / aceptados](#4-hallazgos-pendientes--aceptados)
5. [Principios universales](#5-principios-universales-de-seguridad)
6. [Checklist pre-producción](#6-checklist-pre-producción)
7. [Patrones de ataque cubiertos](#7-patrones-de-ataque-cubiertos)
8. [Runbook de incidentes](#8-runbook-de-incidentes-de-seguridad)

---

## 1. Modelo de amenazas

| Actor | Capacidad | Mitigación principal |
|-------|-----------|----------------------|
| **Atacante externo no autenticado** | Brute-force login, SQL injection, XSS | Rate limiting + lockout + Zod + Prisma + CSP |
| **Atacante externo autenticado** | IDOR, escalación de privilegios, leak cross-org | Multi-tenant isolation + RBAC + procedure middleware |
| **Empleado malicioso (insider)** | Acceso indebido a otras orgs, exfiltración | RBAC + audit logs + scope membership |
| **Atacante con sesión robada** | Hijack de cookies, replay tokens | HttpOnly + Secure + SameSite + maxAge 30 min |
| **Phishing / ingeniería social** | Reset de contraseñas | Token uso-único 15 min + rate limit 3/hora |
| **Atacante con acceso al repo** | Lectura de secretos commiteados | `.gitignore` + variables Vercel + scrubbing periódico |

---

## 2. Hallazgos CRÍTICOS resueltos

### 2.1 🔴 IDOR — `ccLocal.byId` no filtraba por organizationId

**Ubicación:** `src/server/trpc/routers/comercial.ts:254`

**Vulnerabilidad:**
```typescript
// VULNERABLE — un ORG_ADMIN podía leer locales de OTRA organización
ctx.db.ccLocal.findUniqueOrThrow({
  where: { id: input.localId },  // ❌ solo por ID
  include: { tenancies, invoices, payments, salesDeclarations },
})
```

**Impacto:** Un usuario autenticado en una organización podía leer locales, contratos de arrendamiento, facturas, pagos y declaraciones de ventas de otras organizaciones simplemente conociendo o adivinando un `localId`.

**Fix:**
```typescript
const local = await ctx.db.ccLocal.findFirst({
  where: { id: input.localId, organizationId: input.organizationId }, // ✅
  include: { ... },
});
if (!local) throw new TRPCError({ code: "NOT_FOUND" });
```

**Lección:** **JAMÁS** usar `findUnique({ where: { id } })` en tablas tenant. Siempre incluir `organizationId` (y opcionalmente `communityId`) en el `where` de Prisma. Usar `findFirst` en lugar de `findUniqueOrThrow` cuando se filtra por compuesta.

---

### 2.2 🔴 IDOR — `ccInvoice.void` permitía anular facturas cross-org

**Ubicación:** `src/server/trpc/routers/comercial.ts:771`

**Vulnerabilidad:** El `findUniqueOrThrow` solo validaba por `invoiceId`, sin verificar que la factura pertenecía a la org del actor. Un usuario podía anular facturas de otras organizaciones.

**Fix:** Cambiado a `findFirst` con `{ id, organizationId }` + manejo explícito de NOT_FOUND. Además se agregó `organizationId` al filtro de `pendingInvoices` para evitar fugar otros locales.

**Lección:** Las **mutaciones destructivas** (delete, void, update) son las más peligrosas en multi-tenancy. Doble validación: middleware + filtro en query.

---

### 2.3 🔴 Endpoint de debug ejecutaba writes sin auth

**Ubicación:** `src/app/api/debug/route.ts`

**Vulnerabilidad:**
```typescript
// VULNERABLE — endpoint público que actualiza DB
export async function GET() {
  await db.community.update({ where: { id }, data: { monthlyFeeUsd: "77.77" } });
}
```

Cualquier visitante podía:
- Modificar la cuota mensual de una comunidad arbitraria
- Leer parte de las env vars (longitud de NEXTAUTH_SECRET, DATABASE_URL parcial)

**Fix:** 
- Protegido con `Bearer ${CRON_SECRET}` usando comparación timing-safe
- Eliminado el write-test (solo lectura ahora)
- `NEXTAUTH_SECRET` ya no expone longitud — solo "SET" / "MISSING"

**Lección:** **Endpoints de debug no van a producción.** Si se requieren para troubleshooting, protegerlos siempre con un secret y solo permitir reads.

---

### 2.4 🔴 NextAuth sin `trustHost` en producción

**Ubicación:** `src/server/auth/config.ts`

**Vulnerabilidad:** Detrás de un proxy reverso (Vercel), NextAuth v5 puede rechazar cookies HTTPS o redirigir a host equivocado si no tiene `trustHost: true` configurado, abriendo la puerta a:
- Login bypass por host header injection
- Cookies que no se establecen → sesión rota → fallback inseguro

**Fix:**
```typescript
NextAuth({
  trustHost: true,
  useSecureCookies: process.env.NODE_ENV === "production",
  ...
})
```

**Lección:** En entornos serverless (Vercel, AWS Lambda), siempre configurar `trustHost`. Las cookies deben usar prefijo `__Secure-` y `Secure: true` en HTTPS.

---

### 2.5 🔴 Sin rate limiting en `requestPasswordReset`

**Ubicación:** `src/server/trpc/routers/auth-security.ts`

**Vulnerabilidad:** Un atacante podía:
1. Llenar la tabla `PasswordResetToken` con millones de registros (DoS de almacenamiento)
2. Spam masivo de emails (DoS reputacional + costo SMTP)
3. Mantener al usuario inundado de emails de reset (phishing-friendly)

**Fix:**
- Máximo **3 solicitudes por usuario por hora** (verificación en BD por `createdAt`)
- Si se excede, devuelve `{ ok: true }` silenciosamente (no revela el límite)
- Delay artificial 200-300ms cuando email no existe → mitiga timing attack para enumeración

**Lección:** Todo endpoint público autenticación-relacionado debe tener rate limit. Sin Redis, usar tabla con timestamp y `count()` con `gte`.

---

### 2.6 🔴 Race condition en contador de intentos fallidos

**Ubicación:** `src/server/auth/config.ts:91`

**Vulnerabilidad:** Patrón vulnerable read-modify-write:
```typescript
// VULNERABLE — race condition
const user = await db.user.findUnique(...);  // attempts: 4
const attempts = user.failedLoginAttempts + 1;
await db.user.update({ data: { failedLoginAttempts: attempts } });  // 5
// Dos requests paralelos pueden ambos leer "4" y escribir "5" → no bloquea
```

**Impacto:** Un atacante podía evadir el lockout enviando requests concurrentes (cada uno solo veía sus intentos previos, no los simultáneos).

**Fix:** Incremento atómico con `{ increment: 1 }` de Prisma:
```typescript
const updated = await db.user.update({
  where: { id },
  data: { failedLoginAttempts: { increment: 1 } },
  select: { failedLoginAttempts: true },
});
if (updated.failedLoginAttempts >= MAX) { /* lockear */ }
```

**Lección:** Operaciones contadoras siempre con `increment`/`decrement` de Prisma o transacción explícita. Nunca leer-modificar-escribir.

---

### 2.7 🔴 Credenciales SMTP reales en CLAUDE.md

**Ubicación:** `CLAUDE.md:393`

**Vulnerabilidad:** El archivo de documentación (versionado en git) contenía:
- Email completo SMTP
- Contraseña SMTP en texto plano

Cualquiera con acceso al repo (incluyendo accidentalmente al hacer público) tenía acceso a la cuenta de email para enviar/recibir.

**Fix:**
- Eliminada la credencial del archivo
- Reemplazada por referencia a env vars de Vercel: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- **Acción adicional requerida (manual):** rotar la contraseña SMTP en Hotmail
- **Pendiente:** auditar git log para limpiar el commit que la introdujo

**Lección:** **NUNCA** commitear credenciales en código ni en docs. Si se filtró: rotar inmediatamente, aunque se borre del archivo (queda en git history).

---

### 2.8 🔴 Datos PII reales en archivos versionados

**Ubicación:** `test-banesco.csv`, seeds, CLAUDE.md

**Vulnerabilidad:** Archivos con datos personales reales (emails, nombres, unidades) en el repo.

**Fix:**
- Eliminado `test-banesco.csv` con nombres reales de personas
- CLAUDE.md scrubeado: nombres específicos reemplazados por descriptores genéricos
- `.gitignore` actualizado para incluir `*.csv` (excepto plantillas)

**Lección:** Para tests usar generadores de datos sintéticos: emails `user1@example.test`, nombres `John Doe`, IDs aleatorios. Nunca PII real.

---

## 3. Hallazgos MEDIOS resueltos

### 3.1 🟡 Comparaciones de secrets sin timing-safe

**Ubicación:** Todos los `/api/cron/*` y `/api/admin/apply-migration-*`

**Vulnerabilidad:** Comparación con `===` permite timing attacks (medir microsegundos para inferir el secret carácter a carácter en redes con ruido bajo).

**Fix:** Helper `verifyBearerToken()` en `src/lib/auth-utils.ts` que usa `crypto.timingSafeEqual()`. Aplicado a:
- `/api/cron/bcv`
- `/api/cron/publish-invoices`
- `/api/cron/cc-overdue`
- `/api/admin/apply-migration-v3` / `v4` / `monthclose`
- `/api/debug`

**Lección:** Comparaciones de secretos siempre con `crypto.timingSafeEqual()`. Validar longitud antes (también en tiempo constante para no leakear longitud).

---

### 3.2 🟡 Strings sin `.max()` permitían DoS

**Ubicación:** Múltiples routers (security.ts, portal.ts, auth-security.ts)

**Vulnerabilidad:** Inputs como `firstName: z.string().min(1)` sin `.max()` permitían enviar strings de 100 MB:
- DoS por memoria (Node procesa el string completo)
- DoS por DB (insertar TEXT gigantes)
- Costos elevados (request body, ancho de banda)

**Fix:** Agregado `.max(N)` a todos los strings:
- Emails: `.max(254)` (RFC 5321)
- Passwords: `.max(128)`
- Notas/razones: `.max(500)`
- Nombres: `.max(100)`

**Lección:** Todo `z.string()` debe tener `.max()`. La regla mnemotécnica: "si el usuario lo escribe, ponle límite".

---

### 3.3 🟡 Logs con PII (emails, teléfonos)

**Ubicación:** `src/server/services/email.ts`

**Vulnerabilidad:** `console.log("[email:dry-run] → ${params.to}")` exponía direcciones de email completas a logs/observabilidad/Vercel.

**Fix:** Redacción antes de loguear:
```typescript
const redacted = params.to.replace(/^(.{2}).*@(.*)$/, "$1***@$2");
console.log(`[email:dry-run] → ${redacted}`);
// "luissilva@gmail.com" → "lu***@gmail.com"
```

**Lección:** Nunca loguear PII completa. Redactar emails (`u***@dominio`), teléfonos (`+58 04**`), tarjetas (`****-****-****-1234`).

---

## 4. Hallazgos pendientes / aceptados

### 4.1 🟢 CSP con `unsafe-eval` y `unsafe-inline`

**Justificación:** Next.js requiere ambos para hidratación y CSS-in-JS. Mitigación: aplicar nonce-based CSP en una iteración futura cuando se migre a un setup compatible (Next.js 15 + middleware).

**Riesgo residual:** Si hay un XSS, el atacante puede ejecutar `eval()`. Mitigado por:
- React escapa automáticamente
- `dangerouslySetInnerHTML` no se usa en el codebase (verificado)

### 4.2 🟢 Inactivity Guard bypasseable client-side

**Justificación:** El componente `InactivityGuard.tsx` puede deshabilitarse desde DevTools, pero **el JWT de NextAuth ya tiene `maxAge: 30 * 60`**, lo que hace que el servidor rechace tokens expirados independientemente del cliente.

**Riesgo residual:** Ninguno — la sesión expira server-side aunque el cliente la mantenga.

### 4.3 🟢 Dependencias en RC/beta

**Estado:** `next-auth@5.0.0-beta.x` y `@trpc/*@11.0.0-rc.x`. Migrar a stable cuando estén disponibles. Por ahora, se monitorean changelogs.

### 4.4 🟡 Recuperación de contraseña falla en silencio — SMTP global caído

**Encontrado:** 04-jul-2026, al enviar un correo de verificación de prueba.

**Problema:** el SMTP global de la plataforma (env vars de Vercel, cuenta Hotmail) tiene la autenticación básica deshabilitada por Microsoft (`"SmtpClientAuthentication is disabled for the Mailbox"`). `auth-security.ts` (`requestPasswordReset`) llama `sendEmail()` **sin** pasar el SMTP de la organización (usa el fallback global roto) y **no revisa `result.success`** — el endpoint devuelve `{ok: true}` igual aunque el correo nunca haya salido. Un residente/admin que pida "olvidé mi contraseña" ve el mensaje de "revisa tu correo" pero el correo nunca llega, sin ningún error visible para nadie.

**Otros sitios con el mismo patrón** (dependen del SMTP global en vez del de organización): `notifications.ts`, varios puntos de `comercial.ts`.

**Mitigación pendiente (elegir una):**
1. Generar una contraseña de aplicación nueva para la cuenta Hotmail del SMTP global.
2. Migrar `requestPasswordReset` y los demás sitios afectados a resolver el SMTP de la organización (como ya hacen `sendPortalCredentials`/`sendEmailAllAtOnce`), con el global solo como último fallback.

**Estado:** no corregido — requiere decisión del cliente sobre cuál mitigación aplicar.

---

## 5. Principios universales de seguridad

### 5.1 Multi-tenant isolation (regla de oro)

```
TODA query Prisma sobre tabla tenant DEBE incluir organizationId (y/o communityId) en el WHERE.
```

**Mal:**
```typescript
db.invoice.findUnique({ where: { id: invoiceId } })
```

**Bien:**
```typescript
db.invoice.findFirst({ where: { id: invoiceId, organizationId } })
```

### 5.2 Procedimientos tRPC

| Uso | Procedure |
|-----|-----------|
| Login, password reset, healthcheck | `publicProcedure` (con rate limit) |
| Cualquier acción de usuario autenticado | `protectedProcedure` (verifica sesión) |
| Acción dentro de una org | `orgProcedure` (verifica membership) |
| Admin de plataforma | `platformProcedure` (verifica role PLATFORM_*) |

### 5.3 Defensa en profundidad

Asume que cada capa puede fallar. Aplica controles en:
1. **Frontend:** validación visual, disabled buttons (UX, no seguridad)
2. **Network:** HTTPS, security headers
3. **Middleware:** auth, rate limit, RBAC
4. **Application:** Zod, business logic
5. **Database:** Foreign keys, unique constraints, row-level filters

### 5.4 Principio del menor privilegio

- `PLATFORM_OWNER` solo para super-admin (1-2 personas)
- `ORG_ADMIN` solo gestiona SU organización
- `OWNER`/`TENANT` solo ve SU unidad
- API tokens: scope mínimo necesario

### 5.5 Auditabilidad

- `AuditLog` global registra acciones financieras
- Pagos nunca se eliminan (solo `voidedAt`)
- Login attempts registran IP y timestamp
- Para investigación post-incidente debe haber rastro

### 5.6 Inputs de usuario son adversariales

```
Asume que CADA input es un intento de exploit hasta que el Zod schema diga lo contrario.
```

- `.max()` en todos los strings
- `.cuid()` o `.uuid()` para IDs (no `z.string()` desnudo)
- `.email()` + `.toLowerCase()` para emails
- Validar enums explícitamente (`z.enum([...])`, no string)
- File uploads: tipo MIME + tamaño + extensión + sanitización

### 5.7 Secretos nunca tocan el código

- ❌ `const SECRET = "abc123"`
- ❌ `# Mi password es: hugochavez2026` (en docs)
- ❌ `git commit .env`
- ✅ `process.env.SECRET` + `.env.example` con placeholder
- ✅ Vercel env vars / AWS Secrets Manager
- Si se filtra: **rotar inmediatamente** + auditar git log

---

## 6. Checklist pre-producción

Antes de cada deploy a producción, verificar:

### 🔐 Auth
- [ ] `NEXTAUTH_SECRET` único por entorno (no compartido dev/prod)
- [ ] `trustHost: true` configurado
- [ ] Cookies con `httpOnly`, `secure`, `sameSite=lax`
- [ ] Session `maxAge` razonable (30 min para SaaS)
- [ ] Account lockout activo (5 intentos / 15 min)
- [ ] Password reset con token <16 min, uso único
- [ ] Rate limit en password reset (3/hora)

### 🛡️ APIs y RBAC
- [ ] Todos los endpoints `/api/*` verifican auth (excepto public health)
- [ ] CRON endpoints validan `Bearer ${CRON_SECRET}` con `timingSafeEqual`
- [ ] Endpoints de migración/admin están protegidos o eliminados
- [ ] Endpoints de debug eliminados o protegidos
- [ ] `findUnique({ where: { id } })` no existe en tablas tenant

### 📦 Inputs
- [ ] Todos los `z.string()` tienen `.max()`
- [ ] IDs validan formato (`.cuid()`/`.uuid()`)
- [ ] Files uploads validan tamaño y MIME
- [ ] Emails normalizados a lowercase

### 🗄️ Multi-tenant
- [ ] Cada tabla tenant tiene `organizationId` no-null
- [ ] Cada query incluye `organizationId` en WHERE
- [ ] Tests de aislamiento cross-org pasan
- [ ] PLATFORM_OWNER bypass está documentado y auditado

### 🌐 Network
- [ ] HTTPS forzado (HSTS header)
- [ ] CSP configurado
- [ ] X-Frame-Options: DENY
- [ ] X-Content-Type-Options: nosniff
- [ ] Referrer-Policy: strict-origin-when-cross-origin

### 🔍 Observability
- [ ] Logs no contienen PII (emails redactados)
- [ ] Errores no leakean stack traces al cliente
- [ ] Audit log activo para acciones críticas

### 🧹 Secretos
- [ ] `.env` NO está en git (verificar `git ls-files | grep .env`)
- [ ] No hay credenciales en CLAUDE.md / README / docs
- [ ] No hay PII en seeds, tests, o CSV de prueba
- [ ] `.gitignore` incluye `.env*`, `*.pem`, `*.key`, archivos sensibles

---

## 7. Patrones de ataque cubiertos

| Ataque | Vector | Mitigación en ResidIA |
|--------|--------|------------------------|
| **Brute force login** | Bot prueba miles de passwords | Lockout tras 5 intentos + 15 min ban |
| **Credential stuffing** | Reutilización de leaks de otros sitios | Lockout + (futuro) 2FA |
| **Password spray** | Mismo password contra muchos emails | Rate limit por IP (futuro) + lockout por usuario |
| **User enumeration** | Detectar emails registrados | Respuesta uniforme + delay artificial |
| **SQL injection** | Inyectar SQL en inputs | Prisma ORM (parametrizado) + Zod |
| **XSS reflected** | Script en URL params | React escapa + CSP |
| **XSS stored** | Script en DB que se renderiza | React escapa + CSP |
| **CSRF** | Forzar acción autenticada | NextAuth tokens + SameSite cookies |
| **Clickjacking** | iframe oculto | `X-Frame-Options: DENY` |
| **MITM** | Interceptar tráfico | HTTPS + HSTS |
| **Session hijacking** | Robar cookie | HttpOnly + Secure + SameSite |
| **IDOR** | Cambiar ID en URL/body | Multi-tenant filter en cada query |
| **Privilege escalation** | Acceder a recursos de mayor rol | RBAC en `orgProcedure` middleware |
| **Timing attack** | Medir tiempo de respuesta | `timingSafeEqual` + delay artificial |
| **DoS por input gigante** | String/file de 1 GB | `.max()` + body size limit |
| **DoS por loop infinito** | Regex catastrófico | No regex con `(a+)+` o similar |
| **Open redirect** | Redirect a sitio malicioso | NextAuth valida callbackUrl |
| **Email injection** | Headers maliciosos | Nodemailer parametrizado |
| **Prompt injection** (AI) | Manipular el modelo | (Mitigación parcial) Function calling con scope server-side |
| **CSV injection** | Fórmula `=cmd|...` en celda | (Pendiente) Sanitizar `=+-@` al inicio |

---

## 8. Runbook de incidentes de seguridad

### 8.1 Si se sospecha credencial filtrada

1. **Rotar inmediatamente** la credencial en el sistema correspondiente
2. Auditar logs de actividad de los últimos 30 días con esa credencial
3. Notificar a usuarios si hubo acceso a sus datos
4. Si está en git: `git filter-repo` para eliminarla del histórico (NO solo `git rm`)
5. Documentar incidente en este archivo, sección "Hallazgos"

### 8.2 Si se detecta intento de brute force

1. Verificar logs: ¿IP única? ¿múltiples cuentas?
2. Si IP única: bloquear en Vercel/Cloudflare WAF
3. Si distribuido: aumentar `MAX_FAILED_ATTEMPTS` temporalmente y monitorear
4. Notificar a usuarios bloqueados con explicación

### 8.3 Si se detecta IDOR explotado

1. **Cortar el endpoint** desplegando una versión que requiera auth o lo desactive
2. Identificar qué datos se expusieron (queries en logs)
3. Notificar a las orgs afectadas (obligación legal según jurisdicción)
4. Aplicar fix con `organizationId` filter
5. Tests de regresión que cubran cross-org access
6. Documentar en este archivo

### 8.4 Si se reporta vulnerabilidad por terceros

1. Confirmar con un POC reproducible
2. Asignar severidad (CVSS si aplica)
3. Patch en branch privado
4. Deploy en ventana de bajo tráfico
5. Disclosure responsable: agradecer al reportante (program de bug bounty futuro)

---

## 9. Próximos pasos / Roadmap de seguridad

### Q3 2026
- [ ] **2FA / MFA** con TOTP (campo `twoFactorSecret` ya está en schema)
- [ ] **WAF** en Cloudflare delante de Vercel
- [ ] **Rate limit por IP** (no solo por usuario) con Upstash Redis
- [ ] **CSP con nonce** en lugar de `unsafe-inline`
- [ ] **Audit log expandido**: registrar TODA mutación, no solo financieras

### Q4 2026
- [ ] **Pen test externo** (empresa de seguridad)
- [ ] **SOC 2 Type I** preparación
- [ ] **Encriptación at-rest** de campos sensibles (cédulas, RIFs) con `pg_crypto`
- [ ] **Backups automáticos** + DR runbook
- [ ] **Bug bounty program** (HackerOne)

### 2027
- [ ] **SOC 2 Type II** auditoría
- [ ] **ISO 27001** si entramos a clientes corporativos
- [ ] **GDPR/LOPD compliance** completo (right to be forgotten, etc.)

---

## 10. Cómo usar esta Biblia en otros proyectos

Esta es la versión **v1.0** de la Biblia de Seguridad de Innova. Para reutilizarla en proyectos futuros:

1. **Copiar el archivo a `docs/SECURITY_BIBLE.md`** del nuevo proyecto
2. **Adaptar la sección 2 (Hallazgos):** algunos no aplicarán (ej: si no es multi-tenant, ignorar IDOR cross-org)
3. **Ejecutar el checklist sección 6** antes del primer deploy
4. **Agregar nuevos hallazgos** descubiertos en auditorías futuras
5. **Actualizar la versión** y fecha al final del documento

> **Regla cardinal:** Cada bug de seguridad encontrado en cualquier proyecto se documenta aquí. Esto convierte cada incidente en aprendizaje permanente.

---

**Versión:** 1.0
**Última actualización:** 2026-05-07
**Mantenedor:** Equipo Innova
**Próxima revisión:** trimestral (o tras cualquier hallazgo crítico)
