# Condominios

Sistema SaaS multi-tenant de gestión de condominios para Venezuela.

> Para el plan completo, arquitectura y roadmap ver [`CLAUDE.md`](./CLAUDE.md).

---

## Requisitos

- **Node.js 20.18+ (≤ 22)** — Node 24 ha dado problemas con Prisma en Windows
- **pnpm 9+**
- **Docker Desktop** (para Postgres, Redis y MinIO locales)

---

## Arranque rápido

```bash
# 1. Levantar servicios (Postgres :5433, Redis :6380, MinIO :9000)
docker compose up -d

# 2. Copiar variables de entorno
cp .env.example .env
# Generar NEXTAUTH_SECRET:
#   openssl rand -base64 32

# 3. Instalar dependencias
pnpm install

# 4. Aplicar migraciones y semillar datos demo
pnpm db:migrate
pnpm db:seed

# 5. Arrancar la app
pnpm dev
```

App disponible en `http://localhost:3000`.

---

## Estructura

```
condominios/
├── CLAUDE.md          ← Plan completo, arquitectura, decisiones
├── prisma/
│   └── schema.prisma  ← Modelo multi-tenant
├── docker-compose.yml ← Postgres + Redis + MinIO
└── src/
    ├── app/           ← Next.js App Router
    ├── server/        ← Lógica de negocio (services, db, auth, trpc)
    ├── components/    ← UI (shadcn + custom)
    ├── lib/           ← Utilidades
    └── workers/       ← BullMQ workers
```

---

## Comandos útiles

| Comando | Descripción |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` | Build de producción |
| `pnpm typecheck` | Verificar tipos sin emitir |
| `pnpm db:migrate` | Aplicar migraciones |
| `pnpm db:reset` | Reset completo de la DB (⚠️ destruye datos) |
| `pnpm db:studio` | UI de Prisma para inspeccionar la DB |
| `pnpm db:seed` | Cargar datos demo |
| `pnpm worker` | Arrancar workers de BullMQ |
| `pnpm test` | Tests unitarios |
| `pnpm test:e2e` | Tests E2E (Playwright) |

---

## Estado actual

**Fase 1 — Core multi-tenant + Auth** (en curso con Opus 4.7)

- [x] Estructura del proyecto
- [x] Schema Prisma multi-tenant
- [x] Docker Compose
- [ ] NextAuth + middleware de tenancy
- [ ] Panel super-admin (CRUD organizaciones, planes, suscripciones)
- [ ] Panel admin de organización
- [ ] Audit log

Ver [`CLAUDE.md`](./CLAUDE.md) sección 5 para el roadmap completo.
