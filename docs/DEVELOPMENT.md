# Development guide

## Prerequisites

- Node.js 22+ (24 LTS recommended, 25 works)
- npm 11+ (workspaces)
- Optional: Docker Desktop (for the full PostgreSQL/Redis/MinIO stack)
- Optional: Android Studio / Xcode for the mobile app

## Install

```bash
git clone <repo> && cd PeopleCore
npm install            # installs workspaces, builds @peoplecore/shared, generates the Prisma client
cp .env.example .env   # then fill in the secrets below
```

`@peoplecore/shared` is consumed from its **built output** (`packages/shared/dist`), which is
why `npm install` builds it. After editing anything in `packages/shared/src`, rebuild it so
the API, web and mobile clients pick the change up:

```bash
npm run build:shared
```

Required values in `.env`:

```bash
JWT_ACCESS_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -base64 32)   # AES-256-GCM key for sensitive columns
```

## Two ways to run locally

### A. No Docker (embedded PostgreSQL)

```bash
# apps/api/.env
DATABASE_DRIVER=pglite
PGLITE_DATA_DIR=./.pgdata     # use "memory" for a throwaway database

npm run dev:api               # http://localhost:4000/api/v1 · docs at /api/docs
npm run dev:web               # http://localhost:5173 (proxies /api to :4000)
```

The API applies the committed Prisma migrations to the embedded database on boot, so the
schema is always current. This mode is perfect for feature work and for CI.

### B. Full stack with Docker

```bash
export JWT_ACCESS_SECRET=… JWT_REFRESH_SECRET=… ENCRYPTION_KEY=…
docker compose -f infra/docker-compose.yml up -d --build
# web  → http://localhost:8080
# api  → http://localhost:4000  (migrations run automatically)
# minio console → http://localhost:9001
```

Seed demo data (either mode):

```bash
npm run db:seed        # "Acme Corporation": 50 employees, demo accounts, leave/attendance/expenses
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev:api` / `dev:web` / `dev:mobile` | Development servers |
| `npm run build` | Build API and web |
| `npm run test` | Unit tests (API + web) |
| `npm run test:e2e --workspace=@peoplecore/api` | HTTP end-to-end tests against in-process PostgreSQL |
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm run build:shared` | Rebuild `@peoplecore/shared` (required after editing its sources) |
| `npm run api:routes` | Regenerate the web client's API route allowlist from the controllers |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create/apply a migration (requires a reachable database) |
| `npm run db:deploy` | Apply committed migrations (production path) |
| `npm run db:dev` | Print the SQL diff between migrations and schema |
| `npm run db:seed` | Demo company |

## Migrations workflow

1. Edit `apps/api/prisma/schema.prisma`.
2. Generate SQL without a live database (works offline):

   ```bash
   cd apps/api
   mkdir -p prisma/migrations/<timestamp>_<name>
   npx prisma migrate diff --from-migrations prisma/migrations \
     --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
   ```

   With a database available you can also use `npx prisma migrate dev --name <name>`.
3. Commit the SQL file. Both `prisma migrate deploy` (production) and the embedded
   development database apply exactly these files, so tests exercise the same DDL as
   production.

## Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest (`src/**/*.spec.ts`) | Pure logic: working-day calculation, balance arithmetic, crypto, password policy, CSV serialisers |
| Integration / e2e | Vitest + `test/utils/test-app.ts`, `test/**/*.e2e-spec.ts` | Boots the real Nest application against an in-memory PostgreSQL, serves it over a Unix socket and exercises real HTTP flows with real SQL |
| Component | Vitest + Testing Library (`apps/web`) | Rendering, permission gating, form validation |

The e2e harness is deliberately close to production: the same global pipes, filters,
versioning and guards are applied, only the transport is a Unix socket (works in sandboxes
and CI without opening ports).

```bash
npm run test:e2e --workspace=@peoplecore/api            # all flows, ~15 s
npx vitest run --config vitest.config.e2e.ts test/leave.e2e-spec.ts   # single flow
```

Critical workflows covered: sign-up/sign-in, MFA enrolment and challenge, refresh-token
rotation with reuse detection, permission enforcement, employee CRUD + data scope,
Employee 360, profile sub-resources, termination, the full leave approval chain with
balance movement, blackout dates, holiday-aware day counting.

The web client additionally guards against API drift: after adding or renaming a
controller route, run `npm run api:routes`. The unit tests then fail if any `api.*()` call
targets a route the backend does not expose, or if a search entity type would navigate to a
route the SPA does not have.

## Conventions

- **ESM everywhere** — relative imports end with `.js` (`import { x } from './y.js'`).
- **Tenant-scoped data** goes through `this.prisma.client`; unscoped access (`prisma.raw`)
  is reserved for authentication, platform administration and seeding.
- **Create payloads** use `tenantScoped({...})`; reads rely on the scope extension.
- **Never query the outer client inside `prisma.transaction(tx => …)`** — the embedded
  development database is single-session and will deadlock. Hoist lookups before the
  transaction or use `tx`.
- **Audit every mutation** with `AuditService.record({ action, entityType, entityId, before, after })`.
- **Domain events** (`EventEmitter2`) connect modules: `leave.approved`, `expense.submitted`,
  `integration.sync_error`, … Notification fan-out listens to those events instead of being
  called directly.
- **Permissions** are added to `packages/shared/src/permissions.ts` first, then used in
  `@RequirePermissions(...)` and in the UI via `useAuth().can(...)`.
- **Errors** are thrown as `AppError` subclasses (`ValidationError`, `NotFoundError`,
  `ConflictError`, `ForbiddenError`) so the global filter produces a stable envelope.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `TENANT_CONTEXT_MISSING` | A query ran on the scoped client without a tenant context — use `prisma.raw` deliberately or wrap in `forTenant`/request context |
| `Transaction API error: expired transaction` | Long operations inside an interactive transaction; raise the budget via `prisma.transaction(fn, { timeout })` or move work out of the transaction |
| Requests hang ~30 s | A query is issued on `prisma.client` while a transaction holds the single session (embedded DB) |
| `ENCRYPTION_KEY must decode to exactly 32 bytes` | Generate with `openssl rand -base64 32` |
| Web shows 401 loops | Access token expired and refresh failed — check the API clock and `JWT_*` secrets match between instances |
