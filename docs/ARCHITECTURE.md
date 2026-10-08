# Architecture

## 1. Overview

PeopleCore is a multi-tenant HR/ERP platform delivered as a **modular monolith** with three
clients. The design goals, in order of priority, are: tenant isolation, auditable
correctness of HR workflows, and a module structure that can be split into services later
without rewriting business logic.

```
                    ┌────────────────┐        ┌────────────────┐
        Browser ───▶│  apps/web       │        │  apps/mobile    │◀─── iOS / Android
                    │  React SPA      │        │  Expo (RN)      │
                    └───────┬────────┘        └───────┬────────┘
                            │  HTTPS · REST /api/v1    │
                    ┌───────▼─────────────────────────▼────────┐
                    │              apps/api (NestJS)           │
                    │  ┌───────────────┬──────────────────┐    │
                    │  │ HTTP layer     │ Domain modules   │    │
                    │  │ guards/pipes   │ (auth, leave, …) │    │
                    │  └───────┬───────┴─────────┬────────┘    │
                    │          │                 │             │
                    │   ┌──────▼──────┐   ┌──────▼───────┐     │
                    │   │ Prisma +    │   │ Jobs (BullMQ │     │
                    │   │ tenant ext. │   │ / inline)    │     │
                    │   └──────┬──────┘   └──────┬───────┘     │
                    └──────────┼──────────────────┼────────────┘
                               │                  │
                    ┌──────────▼─────┐   ┌────────▼───────┐   ┌──────────────┐
                    │ PostgreSQL 18  │   │ Redis          │   │ S3 / MinIO   │
                    │ (row scoped)   │   │ (queues/cache) │   │ (documents)  │
                    └────────────────┘   └────────────────┘   └──────────────┘
```

## 2. Technology choices

| Layer | Choice | Rationale |
| --- | --- | --- |
| API | NestJS 12, ESM, TypeScript 6 | First-class modularity (DI + modules), guards/pipes/interceptors that keep cross-cutting concerns out of business logic |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Typed queries, committed SQL migrations, driver adapters; an embedded WASM PostgreSQL (`PGlite`) is used for tests and Docker-less development |
| Database | PostgreSQL 18 | Transactional integrity, `uuid`, arrays, JSONB, `pg_trgm` for search |
| Cache/queues | Redis 8 + BullMQ 6 | Background jobs (sync, exports, reminders). Without `REDIS_URL` the API runs jobs inline — development only |
| Web | React 19, Vite 8, Tailwind 4, TanStack Query 5, Radix primitives | Fast SPA build, accessible primitives, server-state caching |
| Mobile | React Native (Expo) | One codebase for Android/iOS, push notifications, biometrics |
| Storage | Local filesystem or S3-compatible | `StoragePort` abstraction with presigned URLs for production |
| Observability | Prometheus `/metrics`, structured logs, health probes, optional Sentry DSN | Operational visibility without vendor lock-in |
| Tests | Vitest 4 (+ embedded PostgreSQL) | Unit, integration and HTTP end-to-end tests run without external services |

## 3. Multi-tenancy

**Model:** shared database, shared schema, tenant discriminator on every functional table.

1. **Tenant resolution.** `POST /auth/*` accepts an optional `tenantSlug`; authenticated
   requests carry the tenant inside the access-token claim (`tid`). `PrincipalService`
   loads the principal (identity, roles, effective permissions) and the
   `RequestContextInterceptor` seeds a per-request `AsyncLocalStorage` context with the
   tenant id.
2. **Enforcement (fail-closed).** A Prisma client extension
   (`src/prisma/tenant-scope.extension.ts`) wraps *every* operation on tenant-scoped
   models:
   - reads/writes get `tenantId` injected into `where`;
   - `create` payloads get `tenantId` injected (and mismatches are rejected);
   - reads of soft-deleted models filter `deletedAt: null`;
   - **without a tenant context the query throws** — unscoped access must be explicit
     through `PrismaService.raw`, which is used only by authentication, platform
     administration and seeding.
3. **Background work.** Jobs run inside `PrismaService.forTenant(tenantId, fn)`, so the
   same guarantees apply outside HTTP requests.
4. **Cross-tenant references** are prevented by scoped existence checks before writing
   relations, plus database foreign keys.
5. **Platform operators** (super admins) have no tenant; their endpoints live under
   `/platform/*` and are explicitly guarded (`@SuperAdminOnly`).

Defence in depth for regulated deployments: PostgreSQL row-level security can be layered on
top by setting `app.tenant_id` per transaction (documented in SECURITY.md); the application
layer already refuses cross-tenant queries, so RLS is a second net rather than the only one.

## 4. Backend structure

```
apps/api/src
├── main.ts                 bootstrap: helmet, CORS, validation, versioning, Swagger
├── app.module.ts           composition root (modules, global guards/interceptors/filters)
├── config/                 typed configuration + validation
├── prisma/                 PrismaService, tenant scope extension, request context
├── common/                 guards, decorators, pipes, filters, pagination, crypto, password
├── storage/                StoragePort + local/S3 drivers
└── modules/
    ├── auth/               login, MFA, OAuth, sessions, principal resolution
    ├── rbac/               role/permission catalogue and tenant role seeding
    ├── users/, tenancy/    accounts, invitations, company settings, provisioning
    ├── org/                departments, teams, locations, positions, schedules
    ├── employees/          profiles, sub-resources, Employee 360, data scope
    ├── employment/         contracts, compensation, benefits
    ├── leave/              types, policies, balances, approvals, holidays
    ├── attendance/         punches, breaks, overtime, corrections, geofencing
    ├── documents/          versioned storage, categories, acknowledgements
    ├── calendar/           calendars, events, leave mirroring
    ├── integrations/       integration centre + Google/Microsoft sync engine
    ├── notifications/      in-app/email/push delivery, preferences, reminders
    ├── performance/, training/, expenses/, assets/, requests/
    ├── reports/, search/, dashboard/, gdpr/
    ├── audit/              append-only trail + auto-audit interceptor
    └── health/             liveness, readiness, Prometheus metrics
```

Each module owns its DTOs, service and controller; connections *between* modules happen
through exported services and domain events (`@nestjs/event-emitter`), never by reaching
into another module's tables. That keeps the seams in place for future extraction into
services (see §9).

## 5. Request lifecycle

```
HTTP request
  → helmet / CORS
  → JwtAuthGuard        verify access token, validate session, build principal
  → PermissionsGuard    @RequirePermissions('leave.approve') against effective permissions
  → ThrottlerGuard      per-IP rate limits (stricter on auth endpoints)
  → RequestContextInterceptor    AsyncLocalStorage { requestId, tenantId, userId, … }
  → ValidationPipe      class-validator DTOs, whitelist + forbidNonWhitelisted
  → Controller → Service (domain rules) → Prisma (tenant-scoped)
  → AuditInterceptor    records mutating operations
  → MetricsInterceptor  counters + latency histogram
  → AllExceptionsFilter single error envelope { statusCode, error{code,message}, path, timestamp, requestId }
```

## 6. Key workflows

### 6.1 Leave request & approval

```
employee ──POST /leave/requests──▶ LeaveService
   1. load employee, leave type, policy (default or scoped by department/location)
   2. compute working days (employee schedule workDays − holidays, half-day aware)
   3. validate: notice period, max consecutive days, attachment, blackout dates
   4. validate balance: entitled + carriedOver + adjustment + accrued − used − pending
   5. transaction: create request (PENDING) + approval steps from the policy chain
                   + move days into `pending`
   6. emit `leave.requested` → notifications (approver) ; audit entry
approver ──POST /leave/requests/:id/approve──▶ advance step
   • intermediate step: mark step approved, keep PENDING
   • final step: APPROVED, `pending → used`, emit `leave.approved`
                 → notifications (employee) + calendar mirroring (LEAVE event)
reject  ─▶ skip remaining steps, refund `pending`, emit `leave.rejected`
cancel  ─▶ refund `pending` (if pending) or `used` (if approved), emit `leave.cancelled`
```

### 6.2 Calendar synchronisation

```
IntegrationConnection (OAuth tokens encrypted with AES-256-GCM)
        │
        ├── CalendarSyncMapping  (local calendar ↔ external calendar, syncToken/deltaLink)
        └── EventSyncMapping     (local event ↔ external event id + etag)   ← dedupe key
Pull:  incremental sync per mapping; existing mappings are updated, unknown external ids
       create new local events, removals cancel local events.
Push:  local create/update/delete → provider API; the mapping table guarantees we patch the
       same external event instead of duplicating it; etag/sync-token guard against loops.
Failure: connection status ERROR + lastSyncError, `integration.sync_error` event, retries
         with backoff through the job queue.
```

## 7. Security architecture

- **Authentication**: short-lived JWT access tokens (15 min) + opaque refresh tokens with
  rotation and family-wide revocation on reuse detection. Sessions are first-class rows
  (device, IP, last use) and can be revoked per user or by an administrator.
- **Authorization**: RBAC with 75+ permissions in `packages/shared` (single source of
  truth for API and UI), eight system roles plus tenant-defined custom roles. Guards run on
  every request; row-level scope (`ScopeService`) narrows managers to their reports/teams
  and employees to themselves.
- **Sensitive data**: national IDs, IBANs, MFA secrets and OAuth tokens are encrypted at
  rest (AES-256-GCM, key from `ENCRYPTION_KEY`); compensation and sensitive fields are
  permission-gated and masked in payloads.
- **Passwords**: scrypt with OWASP parameters, policy endpoint, lockout after repeated
  failures, and a timing-equalised sign-in path.
- **Transport & headers**: helmet, strict CORS allowlist, no cookies for API auth (Bearer),
  which removes CSRF from the token path.
- **File uploads**: MIME allowlist, 25 MB cap, storage-key sanitisation, path-traversal
  protection in the local driver, presigned URLs (S3) or authorised API downloads (local).
- **Auditability**: append-only `AuditLog` with actor, action, entity, before/after
  (credential-redacted), IP and request id; automatically populated for mutations.

## 8. Data & reporting

Reporting uses typed Prisma queries (parameterised). Reports are permission- and
scope-aware, and export through the same serializer for CSV, XLSX (ExcelJS), PDF (PDFKit)
and JSON. Saved reports store filters and a schedule; runs are recorded in `ReportRun`.

## 9. Path to services

The modular monolith is deliberately shaped for later extraction:

| Seam | Today | Extraction path |
| --- | --- | --- |
| Notifications | `NotificationsService` + event listeners | Move behind a queue consumer; events are already decoupled |
| Integrations | `IntegrationSyncService` in-process jobs | Dedicated worker deployment consuming the same queue |
| Reporting | On-demand + scheduled job | Separate read model / analytics database |
| Search | PostgreSQL `pg_trgm` | Swap the query implementation behind `SearchService` for OpenSearch |
| Files | `StoragePort` | Already driver-based (S3 in production) |
| Auth | `AuthModule` + JWT | Extract an identity service; tokens are already tenant-scoped and short-lived |

Because cross-module communication flows through services and events rather than shared
tables, extracting a module means replacing its repository calls with an API or queue
contract — the domain rules stay where they are.

## 10. Environments

| Environment | Database | Storage | Queue | Notes |
| --- | --- | --- | --- | --- |
| Local (no Docker) | Embedded PGlite (`DATABASE_DRIVER=pglite`) | Local disk | Inline | Fastest start; migrations auto-applied on boot |
| Local (Docker) | PostgreSQL 18 (`infra/docker-compose.yml`) | MinIO | Redis | Closest to production |
| Test / CI | In-memory PGlite | Local disk (temp) | Inline | `npm run test:e2e`, no external services |
| Staging | Managed PostgreSQL | S3 bucket | Redis | Seeded, real OAuth credentials in test tenants |
| Production | Managed PostgreSQL + replicas | S3 bucket (versioned) | Redis (HA) | Migrations via `prisma migrate deploy`, backups per DEPLOYMENT.md |
