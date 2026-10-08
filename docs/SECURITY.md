# Security

## Threat model

| Asset | Primary threats | Controls |
| --- | --- | --- |
| Employee personal data (HR records, national IDs, IBANs, medical-adjacent notes) | Cross-tenant leakage, over-broad internal access, exfiltration | Fail-closed tenant scoping, permission-gated fields, encryption at rest, audit trail |
| Credentials & sessions | Credential stuffing, token theft, session hijack | scrypt hashing, lockout, TOTP MFA, short-lived access tokens, refresh rotation with reuse detection, session inventory + revocation |
| Compensation data | Insider snooping | Dedicated permissions (`employees.salary.view`, `compensation.view`), masked payloads, audited reads of exports |
| Documents | Unauthorised access, malicious uploads | Authorised downloads (local) or presigned URLs (S3), MIME allowlist, size cap, sanitised keys, per-document confidentiality, audit of every download |
| Integrations | Token theft, webhook spoofing | AES-256-GCM token storage, signed `state` parameter, scope minimisation, sync mappings keyed by external id |
| Platform administration | Privilege escalation | `isSuperAdmin` separate from tenant roles, `/platform/*` guarded, every action audited |
| Availability | Abuse, brute force | Per-IP rate limiting, strict validation, bounded list queries, health probes |

## Authentication

- **Passwords** — scrypt (`N=2^16, r=8, p=1`, 64-byte derived key) with a per-hash salt;
  hashes are stored as `scrypt$N$r$p$salt$hash`, so parameters can be upgraded transparently.
  Policy: 12+ characters, mixed case, digit, symbol, common-word rejection.
- **Lockout** — 10 consecutive failures lock the account for 15 minutes; unknown accounts
  still perform a dummy verification so response time does not reveal existence.
- **Access tokens** — JWT HS256, 15 minutes, carrying `sub` (user), `sid` (session), `tid`
  (tenant). Verified against the configured secret and rejected when the session is revoked.
- **Refresh tokens** — opaque 384-bit random values, stored only as SHA-256 hashes, rotated
  on every use, organised in families. Presenting a rotated token revokes the entire family
  and forces re-authentication (`TOKEN_REUSE_DETECTED`).
- **MFA** — TOTP (RFC 6238, 6 digits, 30-second window) with 10 single-use recovery codes
  stored as hashes. MFA secrets are encrypted at rest; the challenge between password and
  second factor uses a 5-minute signed ticket.
- **OAuth / SSO** — Google and Microsoft via authorization-code flow with a signed
  `state` (10 minutes, single use). Accounts are matched by verified email inside the
  company workspace; unknown identities are rejected unless the flow is an explicit company
  sign-in that may provision an `EMPLOYEE`. Enterprise SAML metadata and certificate slots
  exist in configuration for SSO roll-outs.

## Authorization

- **RBAC** — 75+ permissions in `packages/shared/src/permissions.ts` (one catalogue for API
  and UI), eight system roles seeded per tenant, plus tenant-defined custom roles. System
  roles can only be *extended* by tenants, never weakened, so product updates keep applying.
- **Least privilege** — controllers declare `@RequirePermissions(...)`; guards run before
  validation, so unauthorised requests never touch services.
- **Row-level scope** — `ScopeService` narrows employees to *all* (HR/admin), *team*
  (managers: reports, team members, managed departments) or *self*; the resulting filter is
  ANDed with the caller's filters so a filter can never widen the scope.
- **Self-service** — `*.self.view` permissions expose only the caller's linked employee
  record (`Employee.userId`), never arbitrary records.
- **Sensitive fields** — national IDs, IBANs, medical documents, salary records and notes
  with `HR_ONLY` visibility are stripped or masked unless the matching permission is held.

## Tenant isolation

1. Every functional table has `tenantId` with a foreign key to `Tenant`.
2. A Prisma client extension injects the tenant into every `where`/`data` for tenant-scoped
   models, rejects mismatches, and **throws when no tenant context exists** (fail-closed).
3. `PrismaService.raw` (unscoped) is restricted by code review to authentication, platform
   administration and seeding; it is not exported from any feature module context.
4. Background jobs and the seeder wrap work in `runWithTenantContext(tenantId, …)`.
5. Cross-tenant relation writes are rejected by scoped existence checks before insert.

**Optional hardening for regulated deployments:** enable row-level security and set
`app.tenant_id` per transaction:

```sql
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_tenant_isolation ON "Employee"
  USING ("tenantId" = current_setting('app.tenant_id', true)::uuid);
```

## Data protection

- **In transit** — TLS terminated at the load balancer/ingress; HSTS and strict transport
  policies belong to the edge configuration (documented in DEPLOYMENT.md).
- **At rest** — database-level encryption (managed PostgreSQL) plus application-level
  AES-256-GCM for MFA secrets, OAuth tokens, national IDs and IBANs. Format
  `v1.<iv>.<tag>.<ciphertext>` (base64url) with a 12-byte IV per record and authenticated
  encryption (tampering fails closed). `ENCRYPTION_KEY` is a base64 32-byte secret supplied
  by the environment/secret manager and never committed.
- **Secrets** — all credentials come from environment variables; `.env` is git-ignored and
  the configuration layer refuses to boot in production without JWT secrets and a valid
  encryption key. Integration credentials without configuration degrade to "not available"
  instead of failing obscurely.

## Application hardening

- **Headers** — `helmet` with a cross-origin resource policy tuned for the API; the web
  image adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a
  no-store policy for the entry document.
- **CORS** — explicit allowlist from `CORS_ORIGINS`; credentials are not required because
  API authentication is header-based (no ambient cookies ⇒ no CSRF surface on `/api`).
- **Input validation** — every DTO is validated (whitelist + `forbidNonWhitelisted`);
  SQL is parameterised through Prisma, and the reporting module never interpolates values
  into raw SQL. File uploads are MIME-checked, size-capped and stored under sanitised keys
  with traversal protection.
- **Rate limiting** — global 300 req/min per IP with tighter buckets on authentication,
  password reset, invitation and OAuth endpoints.
- **Error hygiene** — the global filter maps unexpected errors to generic messages
  (`INTERNAL_ERROR`, `DATABASE_<code>`), never leaking stack traces, SQL or record contents
  to clients; details are logged with the request id.
- **Dependencies** — no exotic runtime dependencies; the S3 driver is implemented with
  `node:crypto` signature V4, so the supply-chain surface for storage stays at node core.

## Auditing & monitoring

- Append-only `AuditLog`: actor (user/system/integration), action, entity, entity id,
  before/after snapshots (credential-redacted), IP, user agent, request id.
- Mutations are captured automatically by an interceptor; sensitive workflows (compensation
  changes, leave decisions, role changes, exports, erasures) write explicit entries with
  precise before/after values.
- API access to the trail is read-only (`audit.view`); there is no update or delete path in
  the API, and the table has no `updatedAt`.
- `/metrics` exposes request counters, latency histograms, error counters, job counters and
  database reachability for Prometheus; `/health/ready` gates traffic during deploys.

## Known advisories

`npm audit` reports findings in the dependency trees of the **build/CLI toolchain**, not in
the API request path. At the time of writing, production (`--omit=dev`) exposure is:

| Package | Path | Why it is not exploitable here |
| --- | --- | --- |
| `deepmerge-ts`, `mysql2` | pulled in by the `prisma` CLI (kept in `dependencies` because the container runs `prisma migrate deploy`) | The CLI runs offline during deploy with trusted schema files; `mysql2` is only loaded for MySQL datasources, this product is PostgreSQL-only |
| `uuid` (via `exceljs`) | XLSX export | The advisory concerns `v3/v5/v6` with a caller-supplied buffer; `exceljs` only generates v4 ids without a buffer |
| `braces`, `micromatch`, `metro`, `node-forge`, `xcode` | Expo/Metro build tooling (mobile workspace only) | Build-time only; these packages never run in the API or web runtime |

`npm audit fix --force` is deliberately **not** applied: it resolves these by downgrading
`prisma` to 6.x and `expo` to SDK 44, which would break the application. Re-evaluate each
release and upgrade the upstream packages when their maintainers ship fixes.

## Security operations

1. Secrets are rotated by setting a new value and restarting; rotating `JWT_ACCESS_SECRET`
   invalidates access tokens, rotating `ENCRYPTION_KEY` requires re-encrypting affected
   columns (documented migration procedure in DEPLOYMENT.md).
2. Incident response: revoke sessions (`POST /auth/logout-all`, admin session revoke),
   disable users, rotate secrets, then review `AuditLog` filtered by actor/entity.
3. Recommended cadence: dependency audit each release, secret rotation quarterly,
   restore-from-backup drill quarterly, access review for `users.manage`/`roles.manage`.
