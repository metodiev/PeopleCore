# PeopleCore

Multi-tenant HR/ERP SaaS platform — people, leave, attendance, documents, performance,
training, expenses, assets, reporting and integrations — with a NestJS API, a React web
application and an Expo mobile app sharing the same backend.

```
apps/api      NestJS 12 (ESM) + Prisma 7 + PostgreSQL  — REST API, background jobs, integrations
apps/web      React 19 + Vite 8 + Tailwind 4           — SaaS dashboard (bg/en, dark mode)
apps/mobile   React Native + Expo                      — Android & iOS, same API
packages/shared  Permission catalog, roles, enums and API contracts shared by all clients
infra         Docker Compose, nginx, backup/restore, initialisation SQL
docs          Architecture, ERD, modules, API, security, GDPR, development, deployment
```

## Quick start

```bash
# 1. Install (workspaces) — generates the Prisma client
npm install

# 2. Configure
cp .env.example .env            # set JWT secrets + ENCRYPTION_KEY (see docs/DEVELOPMENT.md)

# 3a. Local development without Docker (embedded PostgreSQL, WASM)
npm run dev:api                 # API on http://localhost:4000  (/api/docs for OpenAPI)
npm run dev:web                 # Web on http://localhost:5173

# 3b. Or the full stack with real PostgreSQL, Redis, MinIO and nginx
docker compose -f infra/docker-compose.yml up -d --build
```

Demo data (optional):

```bash
npm run db:seed                 # creates the "Acme Corporation" tenant with 50 employees
```

| Demo account | Role |
| --- | --- |
| `admin@acme.test` | Company Admin |
| `hr@acme.test` | HR Admin |
| `manager@acme.test` | Manager |
| `accountant@acme.test` | Accountant |
| `employee@acme.test` | Employee |
| `readonly@acme.test` | Read-only |
| `platform@peoplecore.test` | Platform operator (super admin) |

Password for all demo accounts: `Demo-Passw0rd!23`.

## Feature map

| Area | Highlights |
| --- | --- |
| Tenancy | Shared-schema multi-tenancy, per-request tenant context, fail-closed query scoping, per-tenant roles and settings |
| Identity | Email/password, email verification, password reset, invitations, TOTP MFA with recovery codes, refresh-token rotation with reuse detection, Google & Microsoft OAuth/SSO |
| People | Digital employee profile, org structure (departments, teams, locations, positions), employment history, contracts, compensation history, benefits |
| Leave | Leave types, policies with approval chains, balances (entitled/accrued/used/pending/carry-over), multi-level approvals, holidays, blackout dates, working-day calculation |
| Attendance | Clock in/out, breaks, overtime/late calculations, GPS + geofencing (opt-in, consent-tracked), QR/kiosk hooks, corrections with approvals |
| Documents | Versioned storage, categories, expiry reminders, confidentiality levels, digital acknowledgement, local or S3 storage |
| Calendar | Company/team/personal calendars, events, leave mirroring, two-way Google Calendar and Microsoft Graph synchronisation with duplicate prevention |
| Performance | Review cycles, self/manager/peer reviews, goals & OKRs with key results, feedback |
| Training | Courses, assignments with due dates, certifications with expiry tracking, skills matrix, learning plans |
| Finance | Expenses (submission → approval → reimbursement, receipt capture, CSV export hook for accounting), compensation with full history |
| Assets | Inventory, assignment/return lifecycle with condition tracking, warranty reminders |
| Requests | Employee self-service tickets with an HR inbox, comments, SLA statistics |
| Reporting | 12 report types, filters, CSV/XLSX/PDF/JSON export, saved reports and schedules |
| Governance | Append-only audit log, GDPR consent/export/erasure/retention workflows, Prometheus metrics, health probes |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, tenancy, security, data flow
- [Database ERD](docs/ERD.md) — entities, relations and indexes
- [Modules](docs/MODULES.md) — backend/web/mobile module map
- [API](docs/API.md) — conventions and endpoint catalogue
- [Security](docs/SECURITY.md) — controls and threat model
- [GDPR](docs/GDPR.md) — data map, retention, DSAR workflows
- [Development](docs/DEVELOPMENT.md) — local setup, testing, migrations
- [Deployment](docs/DEPLOYMENT.md) — environments, migrations, backups, scaling

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:api` / `npm run dev:web` / `npm run dev:mobile` | Development servers |
| `npm run build` | Build API + web |
| `npm run test` | Unit + component tests |
| `npm run test:e2e` | API end-to-end tests (embedded PostgreSQL) |
| `npm run lint` / `npm run format` | oxlint / prettier |
| `npm run db:migrate` / `npm run db:deploy` | Prisma migrations |
| `npm run db:seed` | Demo company |
| `npm run infra:up` / `npm run infra:down` | Docker Compose stack |

## Status

Actively developed. The API, web and mobile clients are covered by unit and end-to-end tests;
critical workflows (sign-in, MFA, employee lifecycle, leave approval chain, scoped access)
have executable end-to-end coverage in `apps/api/test`.
