# 👋 Bienvenido al proyecto ResidIA / Condominios

> **Para Luis cuando vuelva mañana sin Claude:** todo está configurado. Esta guía te lleva de cero a editando en menos de 2 min.

---

## 🚀 Arrancar (cada vez que abres VS Code)

1. **Verifica que tienes la última versión**:
   ```powershell
   git pull
   ```

2. **Levanta el servidor de desarrollo**:
   - **Opción A — Desde la UI:** `Ctrl + Shift + P` → "Tasks: Run Task" → **🚀 Dev server**
   - **Opción B — Desde terminal** (`Ctrl + ñ`): `pnpm dev`

3. Abre http://localhost:3000 en el navegador

---

## 📂 Estructura del proyecto

| Carpeta | Qué hay |
|---|---|
| `src/app/` | Páginas y rutas (Next.js App Router) |
| `src/app/api/` | Endpoints API (cron, admin, debug) |
| `src/app/org/` | Panel del administrador de organización |
| `src/app/portal/` | Portal del residente |
| `src/app/login/` | Login + recuperar contraseña |
| `src/server/auth/` | Configuración NextAuth |
| `src/server/trpc/routers/` | Lógica de negocio (todos los endpoints tRPC) |
| `src/server/services/` | Servicios reutilizables (email, exchange, pdf, etc.) |
| `src/components/` | Componentes UI compartidos |
| `prisma/schema.prisma` | Modelo de datos (CRÍTICO — leer antes de tocar BD) |
| `docs/` | Documentación: biblia de seguridad, operaciones |

---

## 📚 Documentos que debes leer

1. **`CLAUDE.md`** ← obligatorio. Visión, arquitectura, stack, decisiones, lecciones.
2. **`docs/SECURITY_BIBLE.md`** ← reglas de seguridad que aplican a TODO cambio
3. **`docs/OPERATIONS_RESET_COMMUNITY.md`** ← cómo resetear data de comunidades para demos

---

## ⌨️ Atajos imprescindibles de VS Code

| Atajo | Acción |
|---|---|
| `Ctrl + P` | Abrir archivo por nombre |
| `Ctrl + Shift + P` | Paleta de comandos (busca CUALQUIER acción) |
| `Ctrl + Shift + F` | Buscar en TODO el proyecto |
| `Ctrl + ñ` | Abrir/cerrar terminal |
| `F12` | Ir a la definición de algo |
| `Alt + ←` | Volver atrás (útil después de F12) |
| `F2` | Renombrar variable/función en TODO el proyecto |
| `Ctrl + B` | Mostrar/ocultar sidebar |

---

## 🛠️ Tareas predefinidas

`Ctrl + Shift + P` → "Tasks: Run Task" → elegir:
- 🚀 **Dev server** (pnpm dev)
- 🔄 **Prisma generate** (después de cambiar schema)
- 🔍 **TypeScript check** (verificar que compile)
- 📦 **Install deps** (después de pull si cambió package.json)
- 🚢 **Deploy producción** (vercel deploy --prod)
- 🌐 **Open Prisma Studio** (UI visual de la BD)

---

## 💾 Guardar cambios → producción

```powershell
# 1. Guardas en VS Code (auto-format al guardar)
# 2. En terminal:
git add .
git commit -m "feat: descripción del cambio"
git push                      # actualiza GitHub
vercel deploy --prod          # despliega a residia.vercel.app
```

---

## 🆘 Cosas que SE rompen comúnmente y cómo arreglarlas

| Síntoma | Solución |
|---|---|
| `Cannot find module '@prisma/client'` | `pnpm prisma generate` |
| `Module not found: ...` | `pnpm install` |
| TypeScript ve errores en cosas obvias | `Ctrl + Shift + P` → "TypeScript: Restart TS Server" |
| Cambios en schema.prisma no aplican en producción | Ir a Supabase SQL Editor y aplicar manualmente (ver `docs/OPERATIONS_RESET_COMMUNITY.md`) |
| Puerto 3000 ocupado | Mata procesos: `Get-Process node \| Stop-Process -Force` |
| `git push` pide credenciales | Windows Credential Manager las tiene cacheadas — si no, pide PAT en github.com/settings/tokens |
| `NEXTAUTH_SECRET MISSING` en local | Crear `.env.local` con valores del template (sin cargar a git) |

---

## 🔐 Cosas críticas que NO debes hacer

- ❌ NO commitear `.env`, `.env.local`, `.env.production` (ya están en .gitignore)
- ❌ NO commitear archivos con datos personales reales (CSV, Excel con cédulas/emails)
- ❌ NO usar `findUnique({ where: { id } })` en queries Prisma sobre tablas multi-tenant — siempre incluye `organizationId` (ver biblia de seguridad)
- ❌ NO comparar secretos con `===` — usar `verifyBearerToken()` de `src/lib/auth-utils.ts`
- ❌ NO cambiar `prisma/schema.prisma` sin generar la migración SQL para Supabase
- ❌ NO hacer `git push --force` a master sin revisar

---

## 🤖 Si vuelves a tener Claude

Pásale el archivo `Desktop/Proyectos Innova/02_CONTEXTO_PARA_CLAUDE.md` para que retome contexto inmediato. Y si vas a hacer algo grande, súmale `CLAUDE.md` y `docs/SECURITY_BIBLE.md`.

---

**Última actualización:** 2026-05-08
**Producción:** https://residia.vercel.app
**Repo GitHub:** https://github.com/ovavisionve/Condo-
