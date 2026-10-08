# API reference

Base URL: `/api/v1` (versioned in the path; `/health`, `/health/ready` and `/metrics` are
unversioned). Interactive OpenAPI documentation is served at `/api/docs` in non-production
environments.

## Conventions

| Topic | Rule |
| --- | --- |
| Auth | `Authorization: Bearer <access token>`; access tokens live 15 minutes, refresh tokens rotate on use |
| Tenancy | From the access-token claim; `POST /auth/login` and `POST /auth/register` accept an optional `tenantSlug` |
| Errors | `{ "statusCode": 400, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": … }, "path": "/api/v1/leave/requests", "timestamp": "…", "requestId": "…" }` |
| Pagination | `?page=1&pageSize=25&sortBy=createdAt&sortOrder=desc` → `{ data: [...], meta: { page, pageSize, total, totalPages } }` |
| Filtering | Resource-specific query parameters (`status`, `departmentId`, `from`, `to`, `search`, …) |
| Validation | `class-validator` DTOs; unknown properties are rejected with `VALIDATION_ERROR` |
| Rate limits | 300 requests/minute per IP by default, 5–30/minute on auth endpoints (`RATE_LIMITED`) |
| Permissions | Every endpoint declares required permissions; failures return `403 PERMISSION_DENIED` |
| Idempotency | Mutations are audited with actor, before and after values |

Error codes you will encounter: `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOKEN_INVALID`,
`TOKEN_REUSE_DETECTED`, `SESSION_REVOKED`, `MFA_CODE_INVALID`, `PERMISSION_DENIED`,
`NOT_FOUND`, `DUPLICATE_RECORD`, `CONFLICT`, `INSUFFICIENT_BALANCE`, `RATE_LIMITED`,
`STALE_VERSION`, `INTEGRATION_ERROR`, `TENANT_CONTEXT_MISSING`.

## Endpoint catalogue

### /auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Create a company + first administrator |
| POST | `/auth/login` | Returns `{ mfaRequired, tokens? , mfaToken? }` |
| POST | `/auth/mfa/verify` | Complete the MFA challenge |
| POST | `/auth/refresh` | Rotate the refresh token (reuse ⇒ family revoked) |
| POST | `/auth/logout` · `/auth/logout-all` | Revoke current / all sessions |
| GET | `/auth/me` | User, company, roles, effective permissions |
| POST | `/auth/verify-email` · `/auth/resend-verification` | Email verification |
| POST | `/auth/forgot-password` · `/auth/reset-password` · `/auth/change-password` | Password flows |
| POST | `/auth/mfa/setup` · `/auth/mfa/enable` · `/auth/mfa/disable` · `/auth/mfa/recovery-codes` | MFA lifecycle |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | Session management |
| POST | `/auth/invitations/accept` | Accept an invitation |
| GET | `/auth/oauth/:provider/start` · `/auth/oauth/:provider/callback` · POST `/auth/oauth/exchange` | Google/Microsoft sign-in |

### Tenancy, users, roles
| Method | Path |
| --- | --- |
| GET/PATCH | `/tenants/current`, `/tenants/current/privacy`, `/tenants/current/overview` |
| GET/POST/PATCH | `/platform/tenants`, `/platform/tenants/:id/status` (super admin) |
| GET/POST/PATCH/DELETE | `/users`, `/users/:id`, `/users/:id/roles`, `/users/:id/sessions/:sessionId` |
| GET/POST/DELETE | `/users/invitations`, `/users/invitations/:id` |
| GET | `/permissions`, `/roles` · POST/PATCH/DELETE `/roles`, `/roles/:id` |

### People & organisation
| Method | Path |
| --- | --- |
| GET/POST/PATCH/DELETE | `/employees`, `/employees/:id` |
| GET | `/employees/me`, `/employees/:id/360`, `/employees/:id/history` |
| POST | `/employees/:id/terminate` |
| GET/POST/PATCH/DELETE | `/employees/:id/profile/:resource(/:itemId)` where resource ∈ emergency-contacts, bank-accounts, education, skills, languages, notes |
| GET/POST/PATCH/DELETE | `/departments`, `/teams`, `/locations`, `/positions` |
| GET/POST/PATCH | `/schedules`, `/schedules/assign` |
| GET/POST/PATCH | `/contracts`, `/contracts/:id`, `/contracts/expiring` |
| GET/POST | `/employees/:id/compensation`, `/employees/:id/benefits`, DELETE `/benefits/:id` |

### Leave & attendance
| Method | Path |
| --- | --- |
| GET/POST/PATCH | `/leave/types`, `/leave/policies`, `/leave/holidays`, `/leave/blackouts` |
| GET | `/leave/balances/me`, `/leave/balances/:employeeId`, `/leave/calendar` |
| POST | `/leave/balances/adjust` |
| GET/POST | `/leave/requests`, `/leave/requests/:id`, `/leave/requests/pending-approval` |
| POST | `/leave/requests/:id/approve|reject|cancel` |
| POST/GET | `/attendance/clock-in`, `/attendance/clock-out`, `/attendance/today`, `/attendance` |
| POST | `/attendance/breaks/start`, `/attendance/breaks/end`, `/attendance/kiosk/punch` |
| GET | `/attendance/missing-punches`, `/attendance/summary` |
| GET/POST | `/attendance/corrections`, `/attendance/corrections/:id/approve|reject` |

### Documents, calendar, integrations
| Method | Path |
| --- | --- |
| GET/POST/PATCH/DELETE | `/documents`, `/documents/:id`, `/documents/categories`, `/documents/:id/versions`, `/documents/:id/download`, `/documents/:id/acknowledge`, `/documents/expiring` |
| GET/POST/PATCH/DELETE | `/calendars`, `/calendars/:id` (calendars) |
| GET/POST/PATCH/DELETE | `/calendar/events`, `/calendar/events/:id`, `/calendar/events/:id/respond` (events) · `/calendar/holidays` |
| GET | `/integrations`, `/integrations/status` |
| POST | `/integrations/:provider/connect`, `/integrations/:provider/sync`, DELETE `/integrations/:provider` |
| GET | `/integrations/:provider/callback` (public OAuth redirect) |

### Performance, training, expenses, assets, requests
| Method | Path |
| --- | --- |
| GET/POST/PATCH | `/performance/cycles`, `/performance/reviews`, `/performance/goals`, `/performance/key-results/:id`, `/performance/feedback`, `/performance/dashboard` |
| GET/POST/PATCH | `/training/courses`, `/training/assignments`, `/training/certifications`, `/training/skills`, `/training/skills/matrix`, `/training/plans`, `/training/dashboard` |
| GET/POST/PATCH | `/expenses`, `/expenses/categories`, `/expenses/summary`, `/expenses/export` |
| POST | `/expenses/:id/submit|approve|reject|request-changes|reimburse|cancel` |
| GET/POST/PATCH | `/assets`, `/assets/:id`, `/assets/dashboard`, `/assets/employee/:employeeId` |
| POST | `/assets/:id/assign|return|repair|retire` |
| GET/POST/PATCH | `/requests`, `/requests/inbox`, `/requests/:id`, `/requests/:id/comments`, `/requests/stats` |
| POST | `/requests/:id/assign`, `/requests/:id/status`, `/requests/:id/cancel` |

### Notifications, reporting, search, dashboards, governance
| Method | Path |
| --- | --- |
| GET | `/notifications`, `/notifications/preferences` · POST `/notifications/:id/read`, `/notifications/read-all`, `/notifications/broadcast`, `/notifications/devices` |
| GET | `/reports/catalog`, `/reports/:type`, `/reports/saved`, `/reports/runs` · POST `/reports/export`, `/reports/saved/:id/run` |
| GET | `/search?q=&types=` |
| GET | `/dashboard/me`, `/dashboard/manager`, `/dashboard/hr`, `/dashboard/admin` |
| GET/POST | `/gdpr/consents`, `/gdpr/export`, `/gdpr/erasure`, `/gdpr/retention`, `/gdpr/overview` |
| GET | `/audit-logs` |
| GET | `/health`, `/health/ready`, `/metrics` |

## Examples

```bash
# Sign in
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@acme.test","password":"Demo-Passw0rd!23","tenantSlug":"acme"}'

# Create an employee
curl -s -X POST http://localhost:4000/api/v1/employees \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","workEmail":"ada@acme.test","hireDate":"2026-02-01"}'

# Submit then approve leave
curl -s -X POST http://localhost:4000/api/v1/leave/requests \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"leaveTypeId":"<uuid>","startDate":"2026-07-01","endDate":"2026-07-05","reason":"Vacation"}'
```
