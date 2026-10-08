# GDPR & privacy

PeopleCore processes employee data on behalf of its customers (the employers). In GDPR
terms the employer is the **controller** and PeopleCore is the **processor**; the platform
provides the tooling both parties need to meet their obligations.

## 1. Data map

| Category | Data | Storage | Lawful basis (typical) | Retention control |
| --- | --- | --- | --- | --- |
| Identity | Name, work/personal email, phone, address, birth date, gender, photo | `Employee`, `User` | Contract / legal obligation | Retained while employed + configured period |
| National identifiers | National ID / EGN / SSN | `Employee.nationalIdEnc` (encrypted) | Legal obligation (payroll, tax) | Deleted or anonymised per retention policy |
| Financial | IBAN, BIC, bank, salary changes, benefits | `BankAccount.ibanEnc`, `CompensationChange`, `Benefit` | Contract / legal obligation | Payroll retention period |
| Employment | Contracts, history, schedules, attendance, leave | `Contract`, `EmploymentHistory`, `AttendanceEntry`, `LeaveRequest` | Contract / legal obligation | Statutory retention (labour law) |
| Documents | Contracts, certificates, IDs, medical-adjacent documents | `Document` + object storage | Legal obligation / consent | Per category `defaultRetentionDays` |
| Performance | Reviews, goals, feedback | `PerformanceReview`, `Goal`, `ReviewFeedback` | Legitimate interest | HR retention policy |
| Health-adjacent | Sick leave, medical certificates | `LeaveRequest`, `Document` | Legal obligation, restricted access | Shortest viable retention |
| Location | GPS punch coordinates (opt-in) | `AttendanceEntry.clockInLat/Lng` | Consent (per punch) | Raw coordinates can be dropped by policy |
| Consent | Consent records with version + source | `ConsentRecord` | Legal obligation (proof) | Retained as evidence of consent |
| Technical | Sessions, audit log, IP addresses | `Session`, `AuditLog` | Legitimate interest (security) | Audit 24 months typical, security logs 90 days |
| Notifications | Templates + delivery metadata | `Notification` | Legitimate interest / contract | Truncated per retention policy |

## 2. Privacy defaults shipped with the product

- GPS attendance is **off by default** (`TenantPrivacySettings.gpsTrackingEnabled = false`).
  When enabled, every punch stores a consent flag and GPS punches require an accepted
  `GPS_TRACKING` consent record; coordinates are optional when the employee is not on site.
- Biometric login is disabled by default and never leaves the device: biometric checks run
  locally through the OS; the platform only stores a flag that biometric unlock is enabled.
- Employees can see and export their own data, and can request erasure where their
  jurisdiction allows it.
- Confidential documents are `INTERNAL` by default; `RESTRICTED` documents require the
  `employees.sensitive.view` permission.
- Audit entries redact credentials, tokens and secrets automatically.

## 3. Data-subject rights

| Right | Implementation |
| --- | --- |
| Access / portability | `POST /gdpr/export` (self-service or HR) builds a JSON bundle of everything stored about the person and stores it as a document; completion is notified and recorded |
| Rectification | Employee profile and sub-resources are editable; every change is audited with before/after values |
| Erasure | `POST /gdpr/erasure` → approval → `ANONYMIZE` (default: personal identifiers replaced, aggregate history kept for legal obligations) or `DELETE` (personal sub-resources hard-deleted, employee soft-deleted) |
| Restriction / objection | Consent revocation (`POST /gdpr/consents/:id/revoke`) stops optional processing such as GPS tracking or marketing; employees can be disabled from processing without deleting history |
| Transparency | `/gdpr/overview` exposes the company's privacy settings, DPO contact and request statistics to HR |

Erasure and export requests are first-class rows (`DataExportRequest`, `ErasureRequest`) with
status, requester, decision maker and timestamps — auditable evidence for the DPO.

## 4. Retention

`RetentionPolicy` rows configure `dataType` + `retentionDays` + `action`
(`ANONYMIZE|DELETE|ARCHIVE`). The daily job applies the policies per tenant; results are
logged and audited. Defaults: documents follow their category, notifications 180 days,
audit log 730 days, sessions 30 days after expiry, attendance 3650 days (labour-law
typical) unless the company configures otherwise.

## 5. Processor obligations

- **Sub-processors**: only those the operator configures (managed PostgreSQL, S3 storage,
  email provider, push provider, optional Sentry). No third-party data sharing happens by
  default; Google/Microsoft are used solely for the integrations a customer explicitly
  connects.
- **Data location**: deployment-dependent; the platform stores everything in the database
  and object storage the operator provisions.
- **Security measures**: see [SECURITY.md](./SECURITY.md) — encryption in transit and at
  rest, least-privilege access, audit logging, incident tooling.
- **Breach notification**: the audit trail plus export/erasure logs provide the facts
  required for a 72-hour notification; the incident procedure is in SECURITY.md §Security
  operations.

## 6. Operating the workflows

```bash
# Company-side privacy configuration (HR admin)
PATCH /api/v1/tenants/current/privacy   { "dpoEmail": "dpo@acme.test", "gpsTrackingEnabled": false }

# Employee requests their data
POST /api/v1/gdpr/export                { "subjectEmployeeId": "<self>" }

# HR handles an erasure request
POST /api/v1/gdpr/erasure               { "subjectEmployeeId": "<uuid>", "method": "ANONYMIZE", "reason": "…" }
POST /api/v1/gdpr/erasure/:id/approve

# Configure retention
POST /api/v1/gdpr/retention             { "dataType": "NOTIFICATION", "retentionDays": 180, "action": "DELETE" }
POST /api/v1/gdpr/retention/apply
```
