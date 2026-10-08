# Deployment

## Environments

| Environment | Purpose | Database | Storage | Notes |
| --- | --- | --- | --- | --- |
| Local | Feature work | Embedded PGlite or Docker PostgreSQL | Local disk or MinIO | See DEVELOPMENT.md |
| Staging | Pre-production validation | Managed PostgreSQL (separate instance) | S3 bucket | Real OAuth/Microsoft credentials in a test tenant, seeded demo data |
| Production | Customer traffic | Managed PostgreSQL + read replica | S3 bucket (versioned, encrypted) | Redis with HA, horizontal API replicas |

## Container images

CI publishes two images to GHCR on `main` (`.github/workflows/ci.yml`):

- `ghcr.io/<owner>/<repo>/api:<sha>` — NestJS API, entrypoint applies migrations
  (`RUN_MIGRATIONS=true`, default) and optionally seeds (`RUN_SEED=true`, never in
  production).
- `ghcr.io/<owner>/<repo>/web:<sha>` — static web build behind nginx with `/api` proxying.

For a single-host deployment use `infra/docker-compose.yml`; for Kubernetes/ECS run the two
images plus PostgreSQL and Redis (the compose file documents every environment variable).

## Required environment variables

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Enables production validation and disables Swagger |
| `DATABASE_URL` | PostgreSQL connection string (use the pooler endpoint) |
| `REDIS_URL` | Queues + rate-limit backing store; omit only for single-process development |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 characters, from a secret manager |
| `ENCRYPTION_KEY` | base64 32 bytes — **back this up**: losing it makes encrypted columns unreadable |
| `WEB_APP_URL`, `CORS_ORIGINS` | Public web origin(s) for links and CORS |
| `STORAGE_DRIVER=s3` + `S3_*` | Object storage for documents and exports |
| `MAIL_DRIVER=smtp` + `SMTP_*` | Transactional email (console driver only for development) |
| `GOOGLE_*` / `MICROSOFT_*` | Optional integration credentials |
| `LOG_LEVEL`, `SENTRY_DSN` | Observability |

## Release procedure

1. Merge to `main` → CI runs lint, typecheck, unit tests, e2e tests, builds and publishes
   images.
2. Run the **Deploy** workflow (`workflow_dispatch` with `staging` first, or push a `v*`
   tag): it applies `prisma migrate deploy` against the target database and calls the
   platform deploy hook.
3. Verify: `/health/ready` reports `database: up`, `/metrics` is scraped, and a smoke login
   succeeds.
4. Roll back by redeploying the previous image tag. Migrations are additive by policy
   (expand → migrate → contract), so the previous version keeps working after a schema
   change.

### Migration policy

- Additive first: add nullable columns/tables, backfill in a job, then tighten in a
  follow-up release. Never drop a column in the same release that stops writing to it.
- Long backfills run through the job queue, not inside the deploy.
- `prisma migrate deploy` runs in the API container entrypoint; run it once per release
  (a dedicated job) when scaling replicas to avoid concurrent migration attempts.

## Backups & disaster recovery

- **Automated backups**: managed PostgreSQL point-in-time recovery (7–35 days) *plus*
  logical dumps via `infra/backup.sh` (cron on the database host or the compose `backup`
  profile service). Dumps are verified with `pg_restore --list` before retention pruning.
- **Object storage**: enable bucket versioning and lifecycle rules; documents are
  immutable per version, so versioning covers accidental deletion.
- **Restore**: `infra/restore.sh backups/peoplecore-<stamp>.dump` restores into the target
  database, followed by `prisma migrate deploy` to apply any newer migrations.
- **Targets**: RPO ≤ 15 minutes (WAL/PITR), RTO ≤ 1 hour (restore + deploy + smoke test).
- **Drill**: quarterly restore into a scratch database, verify counts (`Employee`,
  `Document`, `AuditLog`) and that login works.
- **Secrets**: store `ENCRYPTION_KEY` and JWT secrets in the platform secret manager, with
  an offline break-glass copy — encrypted columns cannot be recovered without the key.

## Scaling & performance

| Component | Approach |
| --- | --- |
| API | Stateless — scale horizontally; keep `RUN_MIGRATIONS=false` on extra replicas |
| Database | Vertical first, then read replicas for reporting; add `pg_trgm` GIN indexes if search grows |
| Queues | Redis + BullMQ workers scale independently; heavy sync/export jobs use dedicated queues |
| Storage | S3 presigned URLs keep file traffic off the API |
| Web | Static assets on CDN; nginx cache headers are already immutable for fingerprinted assets |

Recommended Postgres settings for typical tenants: `shared_buffers` 25% of RAM,
`work_mem` 16–32 MB, `max_connections` sized with the API pool (10 per replica by default),
and `pg_stat_statements` enabled for query review.

## Monitoring & alerting

- **Probes**: `/health` (liveness), `/health/ready` (readiness — verifies the database),
  `/metrics` (Prometheus: request rate/latency/errors, job counters, `peoplecore_database_up`).
- **Suggested alerts**: readiness failing > 2 min; p95 latency > 1 s for 5 min; 5xx ratio
  > 1 % for 5 min; queue depth > 1 000 or oldest job > 15 min; connection pool saturation;
  backup missing for 24 h.
- **Logs**: structured, include `x-request-id` — correlate with `AuditLog.requestId` for
  incident forensics.
- **Error tracking**: set `SENTRY_DSN` to enable client-side capture; audit entries remain
  the source of truth for who did what.

## Post-deploy checklist

- [ ] `/health/ready` → `status: ok`, `database: up`
- [ ] Sign-in works for a demo/admin account, MFA challenge still enforced
- [ ] Migrations applied (`_prisma_migrations` has the latest row)
- [ ] Background jobs processed (queue metrics advancing, reminders registered)
- [ ] Documents upload/download against the production bucket
- [ ] Integration sync for at least one connected calendar (Google or Microsoft)
- [ ] Backup job ran within the last 24 hours
