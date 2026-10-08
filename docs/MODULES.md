# Module map

## Backend (`apps/api/src`)

Every module owns its controller, service, DTOs and Prisma models; cross-module work goes
through exported services or domain events.

| Module | Path | Responsibilities | Key permissions |
| --- | --- | --- | --- |
| auth | `auth/` | Sign-up/sign-in, email verification, password reset, invitations, TOTP MFA, session management, refresh rotation, Google/Microsoft OAuth | public + `notifications.self.manage` |
| rbac | `modules/rbac/` | Permission catalogue, system roles per tenant, custom roles, effective permissions | `roles.view`, `roles.manage` |
| users | `modules/users/` | Accounts, invitations, role assignment, status changes, session revocation | `users.view`, `users.manage` |
| tenancy | `modules/tenancy/` | Company profile, privacy settings, tenant provisioning, platform tenant administration | `settings.*`, `gdpr.manage`, platform |
| audit | `modules/audit/` | Append-only audit trail, auto-audit interceptor, credential redaction | `audit.view` |
| org | `modules/org/` | Departments (hierarchy), teams, locations (geofence), positions, work schedules + assignments | `departments.*`, `teams.*`, `locations.*`, `positions.*`, `schedules.*` |
| employees | `modules/employees/` | Employee lifecycle, profile sub-resources, Employee 360, data scope, sensitive-data masking | `employees.*` |
| employment | `modules/employment/` | Contracts, compensation history, benefits, expiry radar | `contracts.*`, `compensation.*`, `benefits.*` |
| leave | `modules/leave/` | Leave types, policies + approval chains, balances, requests, multi-level approvals, holidays, blackout dates, accrual job | `leave.*` |
| attendance | `modules/attendance/` | Clock in/out, breaks, overtime/late calculation, GPS + geofence, QR/kiosk hooks, corrections | `attendance.*` |
| documents | `modules/documents/` | Categories, versioned uploads, expiry tracking, acknowledgements, storage abstraction | `documents.*`, `employees.documents.*` |
| calendar | `modules/calendar/` | Calendars, events, attendees, leave mirroring, holidays | `calendar.view`, `calendar.manage` |
| integrations | `modules/integrations/` | Integration centre, OAuth connections, Google/Microsoft sync engine with dedupe mappings | `integrations.*`, `calendar.sync` |
| notifications | `modules/notifications/` | In-app/email/push delivery, preferences, device tokens, reminder sweep | `notifications.self.manage`, `notifications.manage` |
| performance | `modules/performance/` | Review cycles, self/manager/peer reviews, goals/OKRs/key results, feedback, dashboard | `performance.*` |
| training | `modules/training/` | Courses, assignments, certifications, skills matrix, learning plans | `training.*` |
| expenses | `modules/expenses/` | Categories, submission, approval workflow, reimbursement, summary + CSV export | `expenses.*` |
| assets | `modules/assets/` | Inventory, assignment/return lifecycle, condition tracking, dashboard | `assets.*` |
| requests | `modules/requests/` | Employee tickets, HR inbox, comments, SLA statistics | `requests.*` |
| reports | `modules/reports/` | 12 report types, CSV/XLSX/PDF/JSON exporters, saved reports + runs | `reports.*` |
| search | `modules/search/` | Global search across people, org, documents, requests, assets | `search.global` |
| dashboard | `modules/dashboard/` | Role dashboards (employee, manager, HR, company admin) | `dashboard.view` + module permissions |
| gdpr | `modules/gdpr/` | Consents, data export, erasure, retention policies, overview | `gdpr.*` |
| health | `modules/health/` | Liveness, readiness, Prometheus metrics | public |
| jobs | `jobs/` | Queue port (BullMQ or inline), job registration, scheduled reminders | — |
| storage | `storage/` | `StoragePort` with local and S3 drivers | — |

## Web (`apps/web/src`)

```
src/
├── main.tsx, App.tsx        providers, routing, route guards
├── components/
│   ├── ui/                  design system: button, card, input, table, dialog, tabs, badge,
│   │                        avatar/switch/tooltip, page header, pagination, skeletons
│   ├── layout/app-shell.tsx sidebar navigation, header, search, notifications
│   ├── global-search.tsx    ⌘K command palette over /search
│   └── notification-bell.tsx
├── pages/                   one module per route (dashboard, people, employee 360, leave,
│                            attendance, requests, documents, performance, training, expenses,
│                            assets, reports, integrations, settings, profile, auth screens)
├── lib/                     api client (fetch + refresh), formatting utilities, cn()
├── store/auth.ts            session state (zustand + persist), permission helper
└── i18n/                    bg/en resources
```

Feature rules: data access through TanStack Query hooks, forms with react-hook-form + zod,
every action permission-gated with `useAuth().can(...)`, and loading/empty/error states on
every list.

## Mobile (`apps/mobile/src`)

| Area | Screens |
| --- | --- |
| Auth | Login (with biometrics), MFA challenge |
| Core | Dashboard (clock in/out, balances, approvals shortcut), Profile, Notifications + preferences |
| HR | Leave (balances, requests, approvals), Attendance (punches, corrections), Calendar, Requests, Documents, Team |
| Platform | Push registration (`POST /notifications/devices`), secure token storage, bg/en language toggle |

The mobile app consumes the same REST API and the same permission model as the web app —
no mobile-specific endpoints.
