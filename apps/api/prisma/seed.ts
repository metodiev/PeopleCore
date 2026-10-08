/**
 * PeopleCore demo seed — "Acme Corporation".
 *
 * Run it with:
 *   npm run db:seed            (node --experimental-strip-types --env-file=.env prisma/seed.ts)
 *
 * Database handling
 * -----------------
 * The seed mirrors `PrismaService`'s adapter selection:
 *  - `DATABASE_DRIVER=postgres` (primary path) → `@prisma/adapter-pg` against
 *    the PostgreSQL server in `DATABASE_URL`; apply migrations beforehand with
 *    `prisma migrate deploy`.
 *  - `DATABASE_DRIVER=pglite` (development/demo) → embedded PostgreSQL (WASM)
 *    through `prisma-pglite-bridge/pool`; the committed migrations are applied
 *    by `applyPgliteMigrations` from `src/prisma/pglite-migrator.ts`.
 *
 * Why the module hook below
 * -------------------------
 * Node's type stripping executes `.ts` files but does not rewrite the `.js`
 * relative specifiers that TypeScript emits, and it cannot execute decorators —
 * so the seed cannot boot the Nest application context. Instead it reuses the
 * pieces that carry no decorators (the generated Prisma client, the password
 * utility, the PGlite migrator) and mirrors the provisioning defaults from
 * `TenantProvisioningService` / `RbacService` so the resulting tenant is
 * identical to one created through the API.
 *
 * The script is idempotent: every entity is upserted by its natural key, bulk
 * inserts are guarded by an existence check, and re-running it produces the
 * same demo data set without duplicating rows.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { register } from 'node:module';
import type { PGlite } from '@electric-sql/pglite';

const loaderSource = [
  '// Maps TypeScript-style "./x.js" specifiers onto the real "./x.ts" files.',
  'export async function resolve(specifier, context, nextResolve) {',
  '  try {',
  '    return await nextResolve(specifier, context);',
  '  } catch (error) {',
  "    if (specifier.startsWith('.') && specifier.endsWith('.js')) {",
  "      return await nextResolve(specifier.slice(0, -3) + '.ts', context);",
  '    }',
  '    throw error;',
  '  }',
  '}',
].join('\n');
register(`data:text/javascript;base64,${Buffer.from(loaderSource).toString('base64')}`, import.meta.url);

type PrismaModule = typeof import('../src/generated/prisma/client.js');
/** Instance type of the generated Prisma client (the module also exports the constructor as a value). */
type Db = import('../src/generated/prisma/client.js').PrismaClient;
type SharedModule = typeof import('@peoplecore/shared');

/** Loads a source module through its real `.ts` path (Node type stripping). */
async function loadSource<T>(relativePath: string): Promise<T> {
  return (await import(new URL(relativePath, import.meta.url).href)) as T;
}

// ─── Demo identity ───────────────────────────────────────────────────────────

const TENANT_SLUG = 'acme';
const TENANT_NAME = 'Acme Corporation';
const DEMO_PASSWORD = 'Demo-Passw0rd!23';
const YEAR = new Date().getUTCFullYear();
const TODAY = startOfUtcDay(new Date());

interface DemoAccount {
  email: string;
  firstName: string;
  lastName: string;
  roleKey: string;
  employeeNumber?: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'admin@acme.test', firstName: 'Ada', lastName: 'Angelova', roleKey: 'COMPANY_ADMIN', employeeNumber: 'EMP-0001' },
  { email: 'hr@acme.test', firstName: 'Hana', lastName: 'Hristova', roleKey: 'HR_ADMIN', employeeNumber: 'EMP-0002' },
  { email: 'manager@acme.test', firstName: 'Mila', lastName: 'Mihaylova', roleKey: 'MANAGER', employeeNumber: 'EMP-0003' },
  { email: 'accountant@acme.test', firstName: 'Georgi', lastName: 'Ganev', roleKey: 'ACCOUNTANT', employeeNumber: 'EMP-0004' },
  { email: 'employee@acme.test', firstName: 'Eva', lastName: 'Eftimova', roleKey: 'EMPLOYEE', employeeNumber: 'EMP-0005' },
  { email: 'readonly@acme.test', firstName: 'Rada', lastName: 'Ruseva', roleKey: 'READ_ONLY', employeeNumber: 'EMP-0006' },
];

const PLATFORM_ADMIN_EMAIL = 'platform@peoplecore.test';

// ─── Baseline configuration (mirrors TenantProvisioningService) ──────────────

const DEFAULT_LEAVE_TYPES = [
  { key: 'VACATION', name: 'Paid leave', isPaid: true, accrual: 'ANNUAL_FIXED', days: 20, color: '#6366f1' },
  { key: 'UNPAID', name: 'Unpaid leave', isPaid: false, accrual: 'NONE', days: null, color: '#94a3b8' },
  { key: 'SICK', name: 'Sick leave', isPaid: true, accrual: 'NONE', days: null, color: '#f97316', requiresAttachment: true },
  { key: 'MATERNITY', name: 'Maternity leave', isPaid: true, accrual: 'NONE', days: null, color: '#ec4899', requiresAttachment: true },
  { key: 'PATERNITY', name: 'Paternity leave', isPaid: true, accrual: 'NONE', days: 15, color: '#8b5cf6' },
  { key: 'REMOTE_WORK', name: 'Remote work', isPaid: true, accrual: 'NONE', days: null, color: '#0ea5e9' },
  { key: 'BUSINESS_TRIP', name: 'Business trip', isPaid: true, accrual: 'NONE', days: null, color: '#14b8a6' },
] as const;

const DEFAULT_DOCUMENT_CATEGORIES = [
  { key: 'CONTRACT', name: 'Employment contract', requiresExpiry: false },
  { key: 'AMENDMENT', name: 'Contract amendment', requiresExpiry: false },
  { key: 'IDENTITY', name: 'Identity document', requiresExpiry: true },
  { key: 'CERTIFICATE', name: 'Certificate', requiresExpiry: true },
  { key: 'MEDICAL', name: 'Medical document', requiresExpiry: true },
  { key: 'TAX', name: 'Tax document', requiresExpiry: false },
  { key: 'POLICY', name: 'Company policy', requiresExpiry: false, requiresAcknowledgement: true },
  { key: 'TRAINING', name: 'Training certificate', requiresExpiry: true },
] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  { key: 'TRAVEL', name: 'Travel' },
  { key: 'MEALS', name: 'Meals' },
  { key: 'EQUIPMENT', name: 'Equipment' },
  { key: 'SOFTWARE', name: 'Software' },
  { key: 'TRAINING', name: 'Training' },
  { key: 'OTHER', name: 'Other' },
] as const;

const COMPANY_HOLIDAYS: { name: string; date: string }[] = [
  { name: 'New Year', date: `${YEAR}-01-01` },
  { name: 'Liberation Day', date: `${YEAR}-03-03` },
  { name: 'Orthodox Easter', date: `${YEAR}-04-12` },
  { name: 'Labour Day', date: `${YEAR}-05-01` },
  { name: 'St George’s Day', date: `${YEAR}-05-06` },
  { name: 'Culture and Literacy Day', date: `${YEAR}-05-24` },
  { name: 'Unification Day', date: `${YEAR}-09-06` },
  { name: 'Independence Day', date: `${YEAR}-09-22` },
  { name: 'Awakening Leaders Day', date: `${YEAR}-11-01` },
  { name: 'Christmas Eve', date: `${YEAR}-12-24` },
  { name: 'Christmas Day', date: `${YEAR}-12-25` },
  { name: 'Second Christmas Day', date: `${YEAR}-12-26` },
];

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', costCenter: 'CC-100', size: 16 },
  { name: 'Sales', code: 'SAL', costCenter: 'CC-200', size: 10 },
  { name: 'Marketing', code: 'MKT', costCenter: 'CC-300', size: 8 },
  { name: 'Human Resources', code: 'HR', costCenter: 'CC-400', size: 6 },
  { name: 'Finance', code: 'FIN', costCenter: 'CC-500', size: 10 },
] as const;

const POSITIONS: Record<string, { title: string; level: string }[]> = {
  Engineering: [
    { title: 'Engineering Manager', level: 'L5' },
    { title: 'Senior Software Engineer', level: 'L4' },
    { title: 'Software Engineer', level: 'L3' },
    { title: 'QA Engineer', level: 'L3' },
    { title: 'DevOps Engineer', level: 'L4' },
  ],
  Sales: [
    { title: 'Sales Manager', level: 'L5' },
    { title: 'Account Executive', level: 'L3' },
    { title: 'Sales Development Representative', level: 'L2' },
    { title: 'Customer Success Manager', level: 'L3' },
  ],
  Marketing: [
    { title: 'Marketing Manager', level: 'L5' },
    { title: 'Content Writer', level: 'L3' },
    { title: 'Performance Marketer', level: 'L3' },
    { title: 'Graphic Designer', level: 'L3' },
  ],
  'Human Resources': [
    { title: 'HR Manager', level: 'L5' },
    { title: 'HR Generalist', level: 'L3' },
    { title: 'Recruiter', level: 'L3' },
  ],
  Finance: [
    { title: 'Finance Manager', level: 'L5' },
    { title: 'Accountant', level: 'L3' },
    { title: 'Payroll Specialist', level: 'L3' },
    { title: 'Financial Analyst', level: 'L4' },
  ],
};

const TEAMS = [
  { name: 'Platform Engineering', department: 'Engineering' },
  { name: 'Mobile Applications', department: 'Engineering' },
  { name: 'Enterprise Sales', department: 'Sales' },
  { name: 'Growth Marketing', department: 'Marketing' },
] as const;

const FIRST_NAMES = [
  'Ivan', 'Maria', 'Nikola', 'Elena', 'Petar', 'Viktoria', 'Stoyan', 'Desislava', 'Krasimir', 'Yoana',
  'Dimitar', 'Alexandra', 'Borislav', 'Kristina', 'Todor', 'Svetlana', 'Vasil', 'Teodora', 'Plamen', 'Bilyana',
  'Rosen', 'Nadezhda', 'Atanas', 'Zornitsa', 'Lachezar',
];

const LAST_NAMES = [
  'Ivanov', 'Petrova', 'Georgiev', 'Dimitrova', 'Stoyanov', 'Koleva', 'Todorov', 'Hristova', 'Angelov', 'Markova',
  'Vasilev', 'Ilieva', 'Kovachev', 'Dobreva', 'Nikolov', 'Yaneva', 'Pavlov', 'Metodieva', 'Shipkov', 'Zlateva',
];

const COURSES = [
  { title: 'Information Security Essentials', category: 'Compliance', validityMonths: 12, isRequired: true, durationHours: 3 },
  { title: 'GDPR for Everyone', category: 'Compliance', validityMonths: 24, isRequired: true, durationHours: 2 },
  { title: 'Advanced TypeScript', category: 'Engineering', validityMonths: null, isRequired: false, durationHours: 16 },
  { title: 'Consultative Selling', category: 'Sales', validityMonths: null, isRequired: false, durationHours: 8 },
  { title: 'First-Time Manager', category: 'Leadership', validityMonths: null, isRequired: false, durationHours: 12 },
  { title: 'Workplace Safety', category: 'Compliance', validityMonths: 12, isRequired: true, durationHours: 1 },
];

// ─── Small deterministic helpers ─────────────────────────────────────────────

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic PRNG so repeated seeds produce the same demo data. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = createRandom(20260101);
const randomInt = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const chance = (probability: number): boolean => random() < probability;

function workingDaysBetween(from: Date, to: Date, holidays: Set<string>): number {
  let days = 0;
  for (let cursor = startOfUtcDay(from); cursor <= to; cursor = addDays(cursor, 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(isoDate(cursor))) continue;
    days += 1;
  }
  return days;
}

interface SeedStorage {
  put(storageKey: string, data: Buffer): Promise<{ storageKey: string; sizeBytes: number; checksum: string }>;
}

/**
 * Minimal local filesystem writer with the same key layout as
 * `LocalStorageDriver` (so seeded documents are downloadable through the API).
 * Inlined because the driver module pulls in `AppError`, which uses TypeScript
 * parameter properties that `--experimental-strip-types` cannot execute.
 */
function createSeedStorage(root: string): SeedStorage {
  const base = resolve(root);
  return {
    async put(storageKey, data) {
      const target = join(base, storageKey);
      if (!target.startsWith(base + sep)) throw new Error(`Invalid storage key: ${storageKey}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      return { storageKey, sizeBytes: data.byteLength, checksum: createHash('sha256').update(data).digest('hex') };
    },
  };
}

// ─── Database bootstrap ──────────────────────────────────────────────────────

interface SeedDatabase {
  db: Db;
  driver: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

async function createSeedDatabase(): Promise<SeedDatabase> {
  const url = process.env['DATABASE_URL'] ?? '';
  const driver: 'postgres' | 'pglite' =
    (process.env['DATABASE_DRIVER'] ?? '').toLowerCase() === 'pglite' || url.startsWith('pglite:') ? 'pglite' : 'postgres';
  const { PrismaClient } = (await loadSource<PrismaModule>('../src/generated/prisma/client.ts'));

  // ── Primary path: PostgreSQL ─────────────────────────────────────────────
  if (driver === 'postgres') {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url || 'postgresql://postgres:postgres@localhost:5432/peoplecore',
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
    });
    return { db, driver, close: () => db.$disconnect() };
  }

  // ── Embedded path: PGlite (WASM) + committed migrations ──────────────────
  const { PGlite: PGliteCtor } = (await import('@electric-sql/pglite')) as typeof import('@electric-sql/pglite');
  const { pg_trgm } = (await import('@electric-sql/pglite/contrib/pg_trgm')) as { pg_trgm: unknown };
  const { PgBridgePool } = (await import('prisma-pglite-bridge/pool')) as typeof import('prisma-pglite-bridge/pool');
  const dataDir = process.env['PGLITE_DATA_DIR'] ?? './.pgdata';
  const inMemory = dataDir === 'memory' || dataDir === ':memory:';
  // Load `pg_trgm` so the search migration's trigram indexes apply here too.
  const extensions = { pg_trgm } as never;
  const pglite: PGlite = inMemory
    ? new PGliteCtor({ extensions })
    : new PGliteCtor(dataDir, { extensions });
  await pglite.waitReady;

  const { applyPgliteMigrations } = await loadSource<typeof import('../src/prisma/pglite-migrator.js')>(
    '../src/prisma/pglite-migrator.ts',
  );
  await applyPgliteMigrations(pglite, (message) => console.log(`  · ${message}`));

  const pool = new PgBridgePool({
    pglite,
    syncToFs: process.env['PGLITE_SYNC_TO_FS'] === 'true',
    connectionTimeoutMillis: 60_000,
  });
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const db = new PrismaClient({ adapter: new PrismaPg(pool as never) });
  return {
    db,
    driver,
    close: async () => {
      await db.$disconnect();
      await (pool as unknown as { end: () => Promise<unknown> }).end();
      // The bridge leaves the lifecycle of a caller-provided PGlite instance to
      // us; without this the WASM backend keeps the event loop alive and the
      // process never exits.
      await pglite.close();
    },
  };
}

// ─── Seeding steps ───────────────────────────────────────────────────────────

const shared = (await import('@peoplecore/shared')) as SharedModule;

async function seedTenant(db: Db) {
  const tenant = await db.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME, status: 'ACTIVE' },
    create: {
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      legalName: 'Acme Corporation EOOD',
      domain: 'acme.test',
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      locale: 'en',
      timezone: 'Europe/Sofia',
      currency: 'EUR',
      onboardingDoneAt: new Date(),
      settings: { licenses: 60, demo: true },
    },
  });

  await db.tenantPrivacySettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      dpoName: 'Hana Hristova',
      dpoEmail: 'dpo@acme.test',
      dataProcessingBasis: 'Employment contract and legitimate interest',
      gpsTrackingEnabled: false,
      gpsConsentRequired: true,
      biometricEnabled: false,
      allowEmployeeExport: true,
      allowEmployeeErasure: true,
      defaultRetentionDays: 3650,
    },
  });

  return tenant;
}

/** Permission catalog + the eight system roles, mirroring RbacService. */
async function seedRbac(db: Db, tenantId: string) {
  for (const permission of shared.PERMISSION_CATALOG) {
    await db.permission.upsert({
      where: { key: permission.key },
      create: { key: permission.key, module: permission.module, description: permission.description },
      update: { module: permission.module, description: permission.description },
    });
  }
  const permissions = await db.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  for (const definition of shared.ROLE_DEFINITIONS) {
    if (definition.platformLevel) continue;
    const role = await db.role.upsert({
      where: { tenantId_key: { tenantId, key: definition.key } },
      create: {
        tenantId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        platformLevel: false,
      },
      update: { name: definition.name, description: definition.description },
    });

    const desired = [...new Set(definition.permissions)] as string[];
    const existing = new Set(
      (await db.rolePermission.findMany({ where: { roleId: role.id } })).map((row) => row.permissionId),
    );
    const missing = desired.filter((key) => {
      const id = permissionIdByKey.get(key);
      return id !== undefined && !existing.has(id);
    });
    if (missing.length > 0) {
      await db.rolePermission.createMany({
        data: missing.map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key)! })),
        skipDuplicates: true,
      });
    }
  }
}

async function assignRoles(db: Db, tenantId: string, userId: string, roleKeys: string[]) {
  const roles = await db.role.findMany({ where: { tenantId }, select: { id: true, key: true } });
  const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));
  await db.userRole.deleteMany({ where: { userId } });
  await db.userRole.createMany({
    data: roleKeys
      .filter((key) => roleIdByKey.has(key))
      .map((key) => ({ userId, roleId: roleIdByKey.get(key)! })),
    skipDuplicates: true,
  });
}

async function seedBaseline(db: Db, tenantId: string) {
  for (const leaveType of DEFAULT_LEAVE_TYPES) {
    await db.leaveType.upsert({
      where: { tenantId_key: { tenantId, key: leaveType.key } },
      create: {
        tenantId,
        key: leaveType.key,
        name: leaveType.name,
        isPaid: leaveType.isPaid,
        accrualType: leaveType.accrual,
        defaultDaysPerYear: leaveType.days ?? undefined,
        requiresAttachment: 'requiresAttachment' in leaveType ? leaveType.requiresAttachment : false,
        color: leaveType.color,
        isSystem: true,
      },
      update: {},
    });
  }

  for (const category of DEFAULT_DOCUMENT_CATEGORIES) {
    await db.documentCategory.upsert({
      where: { tenantId_key: { tenantId, key: category.key } },
      create: {
        tenantId,
        key: category.key,
        name: category.name,
        requiresExpiry: category.requiresExpiry,
        requiresAcknowledgement: 'requiresAcknowledgement' in category ? category.requiresAcknowledgement : false,
        isSystem: true,
      },
      update: {},
    });
  }

  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    await db.expenseCategory.upsert({
      where: { tenantId_key: { tenantId, key: category.key } },
      create: { tenantId, key: category.key, name: category.name },
      update: {},
    });
  }

  const schedules = [];
  for (const schedule of [
    { name: 'Standard (Mon–Fri, 9–18)', type: 'FIXED' as const, workDays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', isDefault: true },
    { name: 'Flexible (Mon–Fri)', type: 'FLEXIBLE' as const, workDays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '19:00', flexibleMinutes: 120 },
    { name: 'Part-time (Mon–Fri, 9–13)', type: 'CUSTOM' as const, workDays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '13:00', breakMinutes: 0 },
  ]) {
    schedules.push(
      await db.workSchedule.upsert({
        where: { tenantId_name: { tenantId, name: schedule.name } },
        create: { tenantId, ...schedule },
        update: {},
      }),
    );
  }

  const existingCalendar = await db.calendar.findFirst({ where: { tenantId, type: 'COMPANY' } });
  const companyCalendar =
    existingCalendar ??
    (await db.calendar.create({
      data: { tenantId, name: 'Company calendar', type: 'COMPANY', isDefault: true, color: '#2563eb' },
    }));

  const existingPolicy = await db.leavePolicy.findFirst({ where: { tenantId, isDefault: true } });
  if (!existingPolicy) {
    await db.leavePolicy.create({
      data: {
        tenantId,
        name: 'Standard policy',
        approvalChain: [{ type: 'MANAGER' }, { type: 'HR' }],
        scope: { employmentTypes: ['FULL_TIME', 'PART_TIME'] },
        minNoticeDays: 0,
        isDefault: true,
      },
    });
  }

  for (const holiday of COMPANY_HOLIDAYS) {
    await db.holiday.upsert({
      where: { tenantId_date_name: { tenantId, date: new Date(`${holiday.date}T00:00:00.000Z`), name: holiday.name } },
      create: { tenantId, name: holiday.name, date: new Date(`${holiday.date}T00:00:00.000Z`), isRecurringYearly: true },
      update: {},
    });
  }

  return { schedules, companyCalendar };
}

async function seedOrganization(db: Db, tenantId: string, schedules: { id: string; isDefault: boolean }[]) {
  const locations = [];
  for (const location of [
    { name: 'Sofia HQ', city: 'Sofia', country: 'Bulgaria', address: '22 Vitosha Blvd', timezone: 'Europe/Sofia', isActive: true },
    { name: 'Plovdiv Office', city: 'Plovdiv', country: 'Bulgaria', address: '8 Ivan Vazov St', timezone: 'Europe/Sofia', isActive: true },
  ]) {
    locations.push(
      await db.location.upsert({
        where: { tenantId_name: { tenantId, name: location.name } },
        create: { tenantId, ...location },
        update: {},
      }),
    );
  }

  const departments = new Map<string, { id: string; name: string }>();
  for (const department of DEPARTMENTS) {
    const row = await db.department.upsert({
      where: { tenantId_name: { tenantId, name: department.name } },
      create: { tenantId, name: department.name, code: department.code, costCenter: department.costCenter },
      update: { code: department.code, costCenter: department.costCenter },
    });
    departments.set(department.name, { id: row.id, name: row.name });
  }

  const positions = new Map<string, { id: string; title: string; level: string }[]>();
  for (const [departmentName, entries] of Object.entries(POSITIONS)) {
    const department = departments.get(departmentName)!;
    const created = [];
    for (const entry of entries) {
      const row = await db.position.upsert({
        where: { tenantId_title: { tenantId, title: entry.title } },
        create: { tenantId, title: entry.title, level: entry.level, departmentId: department.id },
        update: { level: entry.level, departmentId: department.id },
      });
      created.push({ id: row.id, title: row.title, level: entry.level });
    }
    positions.set(departmentName, created);
  }

  const teams = new Map<string, { id: string; name: string }>();
  for (const team of TEAMS) {
    const department = departments.get(team.department)!;
    const row = await db.team.upsert({
      where: { tenantId_name: { tenantId, name: team.name } },
      create: { tenantId, name: team.name, departmentId: department.id },
      update: { departmentId: department.id },
    });
    teams.set(team.name, { id: row.id, name: row.name });
  }

  return { locations, departments, positions, teams, defaultScheduleId: schedules.find((s) => s.isDefault)?.id ?? schedules[0]!.id, schedules };
}

interface SeededEmployee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  department: string;
  departmentId: string;
  position: string;
  positionId: string;
  teamId: string | null;
  status: string;
  hireDate: Date;
  isManager: boolean;
}

async function seedEmployees(db: Db, tenantId: string, org: Awaited<ReturnType<typeof seedOrganization>>) {
  const employees: SeededEmployee[] = [];
  const usedEmails = new Set<string>();

  const departmentOf = (name: string) => org.departments.get(name)!;
  const positionsOf = (name: string) => org.positions.get(name)!;

  const demoPlan: { account: DemoAccount; department: string }[] = [
    { account: DEMO_ACCOUNTS[0]!, department: 'Human Resources' },
    { account: DEMO_ACCOUNTS[1]!, department: 'Human Resources' },
    { account: DEMO_ACCOUNTS[2]!, department: 'Engineering' },
    { account: DEMO_ACCOUNTS[3]!, department: 'Finance' },
    { account: DEMO_ACCOUNTS[4]!, department: 'Engineering' },
    { account: DEMO_ACCOUNTS[5]!, department: 'Marketing' },
  ];

  const plan: { firstName: string; lastName: string; department: string; index: number }[] = [];
  demoPlan.forEach((entry) =>
    plan.push({ firstName: entry.account.firstName, lastName: entry.account.lastName, department: entry.department, index: plan.length }),
  );

  for (const department of DEPARTMENTS) {
    const demoInDepartment = demoPlan.filter((entry) => entry.department === department.name).length;
    for (let index = 0; index < department.size - demoInDepartment; index += 1) {
      plan.push({
        firstName: pick(FIRST_NAMES),
        lastName: pick(LAST_NAMES),
        department: department.name,
        index: plan.length,
      });
    }
  }

  const managerByDepartment = new Map<string, string>();

  for (const entry of plan) {
    const employeeNumber = `EMP-${String(entry.index + 1).padStart(4, '0')}`;
    const demo = demoPlan.find((candidate) => candidate.account.employeeNumber === employeeNumber);
    const baseEmail = `${entry.firstName}.${entry.lastName}`.toLowerCase().replace(/[^a-z.]/g, '');
    const workEmail = demo
      ? demo.account.email
      : usedEmails.has(`${baseEmail}@acme.test`)
        ? `${baseEmail}${entry.index}@acme.test`
        : `${baseEmail}@acme.test`;
    usedEmails.add(workEmail);

    const department = departmentOf(entry.department);
    const departmentPositions = positionsOf(entry.department);
    const isDepartmentManager = managerByDepartment.get(entry.department) === undefined;
    const position = isDepartmentManager ? departmentPositions[0]! : (departmentPositions[1 + (entry.index % Math.max(1, departmentPositions.length - 1))] ?? departmentPositions[0]!);

    const isLeaver = !demo && entry.index >= 46;
    const isProbation = !demo && !isLeaver && entry.index % 19 === 0;
    const hireDate = isProbation
      ? addDays(TODAY, -randomInt(20, 70))
      : new Date(Date.UTC(2019 + (entry.index % 6), entry.index % 12, ((entry.index * 7) % 26) + 1));

    const status = demo ? 'ACTIVE' : isLeaver ? 'TERMINATED' : isProbation ? 'PROBATION' : entry.index === 23 ? 'ON_LEAVE' : 'ACTIVE';
    const location = org.locations[entry.index % org.locations.length]!;
    const teamName =
      entry.department === 'Engineering'
        ? entry.index % 2 === 0
          ? 'Platform Engineering'
          : 'Mobile Applications'
        : entry.department === 'Sales'
          ? 'Enterprise Sales'
          : entry.department === 'Marketing'
            ? 'Growth Marketing'
            : null;

    const employee = await db.employee.upsert({
      where: { tenantId_workEmail: { tenantId, workEmail } },
      create: {
        tenantId,
        employeeNumber,
        firstName: entry.firstName,
        lastName: entry.lastName,
        workEmail,
        personalEmail: `${baseEmail.replace('.', '-')}@example.com`,
        phone: `+359${randomInt(87, 89)}${randomInt(1000000, 9999999)}`,
        birthDate: new Date(Date.UTC(1975 + (entry.index % 25), (entry.index * 5) % 12, ((entry.index * 3) % 27) + 1)),
        gender: entry.index % 3 === 0 ? 'FEMALE' : entry.index % 3 === 1 ? 'MALE' : 'UNDISCLOSED',
        address: `ul. Tsarigradsko shose ${10 + entry.index}`,
        city: location.city ?? 'Sofia',
        country: 'Bulgaria',
        status: status as never,
        hireDate,
        terminationDate: isLeaver ? new Date(Date.UTC(YEAR, (entry.index * 2) % 12, ((entry.index * 3) % 26) + 1)) : null,
        terminationReason: isLeaver ? pick(['Resignation', 'Contract ended', 'Relocation']) : null,
        employmentType: entry.index % 11 === 0 ? 'PART_TIME' : entry.index % 13 === 0 ? 'CONTRACT' : 'FULL_TIME',
        workingHoursPerWeek: entry.index % 11 === 0 ? 20 : 40,
        departmentId: department.id,
        teamId: teamName ? (org.teams.get(teamName)?.id ?? null) : null,
        locationId: location.id,
        positionId: position.id,
        scheduleId: org.defaultScheduleId,
      },
      update: { status: status as never, positionId: position.id, departmentId: department.id },
    });

    if (isDepartmentManager) managerByDepartment.set(entry.department, employee.id);

    employees.push({
      id: employee.id,
      employeeNumber,
      firstName: entry.firstName,
      lastName: entry.lastName,
      workEmail,
      department: entry.department,
      departmentId: department.id,
      position: position.title,
      positionId: position.id,
      teamId: teamName ? (org.teams.get(teamName)?.id ?? null) : null,
      status,
      hireDate,
      isManager: isDepartmentManager,
    });
  }

  // Reporting lines: everyone reports to their department manager.
  for (const employee of employees) {
    const managerId = managerByDepartment.get(employee.department);
    if (!managerId || managerId === employee.id) continue;
    await db.employee.update({ where: { id: employee.id }, data: { managerId } });
  }
  for (const [departmentName, managerId] of managerByDepartment) {
    await db.department.update({ where: { id: departmentOf(departmentName).id }, data: { managerId } });
  }
  // Team leads: the first member of each team.
  for (const [, team] of org.teams) {
    const lead = employees.find((employee) => employee.teamId === team.id && employee.status !== 'TERMINATED');
    if (lead) {
      await db.team.update({ where: { id: team.id }, data: { leadId: lead.id } });
    }
  }

  if ((await db.scheduleAssignment.count({ where: { tenantId } })) === 0) {
    await db.scheduleAssignment.createMany({
      data: employees.map((employee) => ({
        tenantId,
        employeeId: employee.id,
        scheduleId: org.defaultScheduleId,
        effectiveFrom: employee.hireDate,
      })),
      skipDuplicates: true,
    });
  }

  return { employees, managerByDepartment };
}

async function seedUserAccounts(db: Db, tenantId: string, seeded: SeededEmployee[]) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = new Map<string, { id: string; email: string; employeeId: string | null }>();

  const accountsToCreate: { email: string; firstName: string; lastName: string; roleKeys: string[]; employee: SeededEmployee | null }[] = [];

  for (const account of DEMO_ACCOUNTS) {
    const employee = seeded.find((candidate) => candidate.employeeNumber === account.employeeNumber) ?? null;
    accountsToCreate.push({
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
      roleKeys: [account.roleKey],
      employee,
    });
  }

  // 19 further employees get logins: department managers and team leads first.
  const candidates = seeded
    .filter((employee) => employee.status !== 'TERMINATED' && !DEMO_ACCOUNTS.some((account) => account.email === employee.workEmail))
    .slice(0, 19);
  for (const employee of candidates) {
    accountsToCreate.push({
      email: employee.workEmail,
      firstName: employee.firstName,
      lastName: employee.lastName,
      roleKeys: [employee.isManager ? 'MANAGER' : 'EMPLOYEE'],
      employee,
    });
  }

  for (const account of accountsToCreate) {
    const user = await db.user.upsert({
      where: { tenantId_email: { tenantId, email: account.email } },
      create: {
        tenantId,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        locale: 'en',
      },
      update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), deletedAt: null },
    });
    if (account.employee) {
      await db.employee.update({ where: { id: account.employee.id }, data: { userId: user.id } });
    }
    await assignRoles(db, tenantId, user.id, account.roleKeys);
    users.set(account.email, { id: user.id, email: user.email, employeeId: account.employee?.id ?? null });
  }

  // Platform super admin — no tenant, not tied to any employee record.
  const existingPlatformAdmin = await db.user.findFirst({ where: { email: PLATFORM_ADMIN_EMAIL, tenantId: null } });
  const platformAdmin =
    existingPlatformAdmin ??
    (await db.user.create({
      data: {
        tenantId: null,
        email: PLATFORM_ADMIN_EMAIL,
        firstName: 'Platform',
        lastName: 'Operator',
        passwordHash,
        status: 'ACTIVE',
        isSuperAdmin: true,
        emailVerifiedAt: new Date(),
        locale: 'en',
      },
    }));

  return { users, platformAdminId: platformAdmin.id, passwordHash };
}

async function seedAttendance(
  db: Db,
  tenantId: string,
  seeded: SeededEmployee[],
  leaveDaysByEmployee: Map<string, Set<string>>,
  holidays: Set<string>,
) {
  if ((await db.attendanceEntry.count({ where: { tenantId } })) > 0) return 0;

  const active = seeded.filter((employee) => employee.status !== 'TERMINATED');
  const entries: {
    tenantId: string;
    employeeId: string;
    date: Date;
    clockIn: Date | null;
    clockOut: Date | null;
    breakMinutes: number;
    workedMinutes: number;
    overtimeMinutes: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    status: never;
    source: never;
  }[] = [];

  for (let offset = 30; offset >= 0; offset -= 1) {
    const date = addDays(TODAY, -offset);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(isoDate(date))) continue;

    for (const employee of active) {
      const onLeave = leaveDaysByEmployee.get(employee.id)?.has(isoDate(date)) ?? false;
      if (onLeave) {
        entries.push({
          tenantId,
          employeeId: employee.id,
          date,
          clockIn: null,
          clockOut: null,
          breakMinutes: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          status: 'LEAVE' as never,
          source: 'WEB' as never,
        });
        continue;
      }

      if (chance(0.03)) {
        entries.push({
          tenantId,
          employeeId: employee.id,
          date,
          clockIn: null,
          clockOut: null,
          breakMinutes: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          status: 'ABSENT' as never,
          source: 'WEB' as never,
        });
        continue;
      }

      const remote = chance(0.12);
      const lateMinutes = chance(0.22) ? randomInt(5, 45) : 0;
      const clockIn = new Date(date.getTime() + (9 * 60 + lateMinutes - randomInt(0, 10)) * 60_000);
      const earlyLeaveMinutes = chance(0.1) ? randomInt(10, 40) : 0;
      const overtimeMinutes = chance(0.25) ? randomInt(15, 120) : 0;
      const clockOut = new Date(
        date.getTime() + (18 * 60 - earlyLeaveMinutes + overtimeMinutes + randomInt(0, 15)) * 60_000,
      );
      const breakMinutes = 60;
      const workedMinutes = Math.max(
        0,
        Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000) - breakMinutes,
      );

      entries.push({
        tenantId,
        employeeId: employee.id,
        date,
        clockIn,
        clockOut,
        breakMinutes,
        workedMinutes,
        overtimeMinutes,
        lateMinutes,
        earlyLeaveMinutes,
        status: (lateMinutes > 10 ? 'LATE' : remote ? 'REMOTE' : 'PRESENT') as never,
        source: (remote ? 'MOBILE' : 'WEB') as never,
      });
    }
  }

  await db.attendanceEntry.createMany({ data: entries, skipDuplicates: true });
  return entries.length;
}

async function seedLeave(
  db: Db,
  tenantId: string,
  seeded: SeededEmployee[],
  users: Map<string, { id: string; email: string; employeeId: string | null }>,
  holidays: Set<string>,
) {
  const leaveTypes = await db.leaveType.findMany({ where: { tenantId } });
  const vacation = leaveTypes.find((type) => type.key === 'VACATION')!;
  const sick = leaveTypes.find((type) => type.key === 'SICK')!;
  const unpaid = leaveTypes.find((type) => type.key === 'UNPAID')!;

  // Balances for the current year: 20 vacation days, as configured.
  for (const employee of seeded) {
    if (employee.status === 'TERMINATED') continue;
    for (const leaveType of leaveTypes) {
      const entitled = leaveType.key === 'VACATION' ? 20 : leaveType.key === 'PATERNITY' ? 15 : leaveType.key === 'SICK' ? 10 : 0;
      await db.leaveBalance.upsert({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: YEAR,
          },
        },
        create: {
          tenantId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          year: YEAR,
          entitled,
          carriedOver: leaveType.key === 'VACATION' ? (employee.status === 'TERMINATED' ? 0 : 5) : 0,
        },
        update: { entitled },
      });
    }
  }

  if ((await db.leaveRequest.count({ where: { tenantId } })) > 0) {
    return { leaveDaysByEmployee: new Map<string, Set<string>>() };
  }

  const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');
  const statuses = [
    ...Array.from({ length: 20 }, () => 'APPROVED'),
    ...Array.from({ length: 10 }, () => 'PENDING'),
    ...Array.from({ length: 5 }, () => 'REJECTED'),
    ...Array.from({ length: 3 }, () => 'CANCELLED'),
    ...Array.from({ length: 2 }, () => 'DRAFT'),
  ];
  const leaveDaysByEmployee = new Map<string, Set<string>>();

  for (const [index, status] of statuses.entries()) {
    const employee = eligible[(index * 3) % eligible.length]!;
    const leaveType = status === 'APPROVED' && index % 5 === 0 ? sick : index % 9 === 0 ? unpaid : vacation;
    const future = index % 3 === 0;
    const startOffset = future ? randomInt(3, 28) : -randomInt(20, 200);
    const startDate = addDays(TODAY, startOffset);
    const days = randomInt(1, 5);
    const endDate = addDays(startDate, days - 1);
    const daysRequested = workingDaysBetween(startDate, endDate, holidays) || days;

    const request = await db.leaveRequest.create({
      data: {
        tenantId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        daysRequested,
        reason: pick(['Family trip', 'Medical appointment', 'Rest', 'Personal matters', 'Wedding', 'Childcare']),
        status: status as never,
        currentStep: status === 'APPROVED' ? 2 : status === 'PENDING' ? 0 : 0,
        submittedAt: status === 'DRAFT' ? null : addDays(startDate, -randomInt(3, 14)),
        decidedAt: status === 'APPROVED' || status === 'REJECTED' ? addDays(startDate, -randomInt(1, 3)) : null,
        cancelledAt: status === 'CANCELLED' ? addDays(startDate, -randomInt(1, 2)) : null,
      },
    });

    if (status !== 'DRAFT') {
      const manager = eligible.find((candidate) => candidate.id !== employee.id && candidate.department === employee.department && candidate.isManager);
      const managerUser = manager ? users.get(manager.workEmail) : undefined;
      const hrUser = users.get('hr@acme.test');
      const decision = status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING';
      await db.leaveApproval.createMany({
        data: [
          {
            tenantId,
            leaveRequestId: request.id,
            stepOrder: 1,
            approverType: 'MANAGER' as never,
            approverId: managerUser?.id ?? null,
            status: (status === 'PENDING' || status === 'CANCELLED' ? 'PENDING' : decision) as never,
            comment: status === 'REJECTED' ? 'Team capacity too low for this period' : null,
            decidedAt: status === 'PENDING' || status === 'CANCELLED' ? null : addDays(startDate, -2),
          },
          {
            tenantId,
            leaveRequestId: request.id,
            stepOrder: 2,
            approverType: 'HR' as never,
            approverId: hrUser?.id ?? null,
            status: (status === 'APPROVED' ? 'APPROVED' : status === 'REJECTED' ? 'APPROVED' : 'PENDING') as never,
            decidedAt: status === 'APPROVED' || status === 'REJECTED' ? addDays(startDate, -1) : null,
          },
        ],
        skipDuplicates: true,
      });
    }

    if (status === 'APPROVED') {
      const days = leaveDaysByEmployee.get(employee.id) ?? new Set<string>();
      for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
        const weekday = cursor.getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        days.add(isoDate(cursor));
      }
      leaveDaysByEmployee.set(employee.id, days);
    }
  }

  // Reconcile balances with the seeded requests.
  const requests = await db.leaveRequest.findMany({ where: { tenantId } });
  for (const employee of eligible) {
    for (const leaveType of leaveTypes) {
      const used = requests
        .filter((request) => request.employeeId === employee.id && request.leaveTypeId === leaveType.id && request.status === 'APPROVED')
        .reduce((sum, request) => sum + Number(request.daysRequested), 0);
      const pending = requests
        .filter((request) => request.employeeId === employee.id && request.leaveTypeId === leaveType.id && request.status === 'PENDING')
        .reduce((sum, request) => sum + Number(request.daysRequested), 0);
      await db.leaveBalance.update({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: YEAR,
          },
        },
        data: { used, pending },
      });
    }
  }

  return { leaveDaysByEmployee };
}

async function seedDocumentsAndContracts(
  db: Db,
  tenantId: string,
  seeded: SeededEmployee[],
  storage: SeedStorage,
  uploadedById: string,
) {
  const categories = await db.documentCategory.findMany({ where: { tenantId } });
  const categoryByKey = new Map(categories.map((category) => [category.key, category]));

  if ((await db.contract.count({ where: { tenantId } })) === 0) {
    for (const [index, employee] of seeded.entries()) {
      const fixedTerm = index % 10 === 1;
      const probation = index % 10 === 2;
      const leaver = employee.status === 'TERMINATED';
      const startDate = employee.hireDate;
      const salary = 3200 + (index % 8) * 450;
      await db.contract.create({
        data: {
          tenantId,
          employeeId: employee.id,
          type: (leaver ? 'PERMANENT' : fixedTerm ? 'FIXED_TERM' : probation ? 'PROBATION' : 'PERMANENT') as never,
          status: (leaver ? 'TERMINATED' : 'ACTIVE') as never,
          number: `C-${YEAR}-${String(index + 1).padStart(4, '0')}`,
          startDate,
          endDate: leaver ? addDays(TODAY, -randomInt(10, 200)) : fixedTerm ? addDays(TODAY, 45) : null,
          probationEndDate: probation ? addDays(TODAY, 10) : addDays(startDate, 90),
          signedAt: addDays(startDate, -7),
          salaryAmount: salary,
          currency: 'EUR',
          workingHoursPerWeek: 40,
          departmentId: employee.departmentId,
          positionId: employee.positionId,
          terminatedAt: leaver ? addDays(TODAY, -randomInt(10, 200)) : null,
          terminationReason: leaver ? 'Resignation' : null,
        },
      });

      if (index % 7 === 0 || employee.isManager) {
        await db.compensationChange.createMany({
          data: [
            {
              tenantId,
              employeeId: employee.id,
              type: 'BASE_SALARY' as never,
              oldAmount: salary - 400,
              newAmount: salary,
              currency: 'EUR',
              effectiveDate: addDays(startDate, 365),
              reason: 'Annual salary review',
              changedById: uploadedById,
            },
            {
              tenantId,
              employeeId: employee.id,
              type: 'BASE_SALARY' as never,
              oldAmount: salary,
              newAmount: salary + 250,
              currency: 'EUR',
              effectiveDate: addDays(TODAY, -randomInt(30, 120)),
              reason: 'Promotion to senior level',
              changedById: uploadedById,
            },
          ],
        });
      }
    }
  }

  if ((await db.document.count({ where: { tenantId } })) > 0) {
    return { documents: 0, documentIds: [] as string[] };
  }

  const plans: { key: string; name: string; expiresInDays: number | null }[] = [
    { key: 'CONTRACT', name: 'Employment contract (signed)', expiresInDays: null },
    { key: 'IDENTITY', name: 'National ID copy', expiresInDays: 25 },
    { key: 'CERTIFICATE', name: 'Professional certificate', expiresInDays: 38 },
    { key: 'MEDICAL', name: 'Medical fitness certificate', expiresInDays: 410 },
    { key: 'TAX', name: 'Tax declaration', expiresInDays: null },
    { key: 'POLICY', name: 'Employee handbook acknowledgement', expiresInDays: null },
    { key: 'TRAINING', name: 'Security awareness certificate', expiresInDays: 180 },
    { key: 'AMENDMENT', name: 'Salary amendment', expiresInDays: null },
  ];

  const documentIds: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    const employee = seeded[(index * 2) % seeded.length]!;
    const plan = plans[index % plans.length]!;
    const category = categoryByKey.get(plan.key)!;
    const content = Buffer.from(`Demo document "${plan.name}" for ${employee.firstName} ${employee.lastName}.`);
    const documentId = randomUUID();
    const storageKey = `${tenantId}/${documentId}/v1/${plan.key.toLowerCase()}.txt`;
    const stored = await storage.put(storageKey, content);

    const document = await db.document.create({
      data: {
        tenantId,
        id: documentId,
        employeeId: employee.id,
        categoryId: category.id,
        name: `${plan.name} — ${employee.firstName} ${employee.lastName}`,
        description: `Seeded demo document for ${employee.employeeNumber}.`,
        confidentiality: plan.key === 'IDENTITY' || plan.key === 'MEDICAL' ? ('CONFIDENTIAL' as never) : ('INTERNAL' as never),
        issuedAt: addDays(TODAY, -randomInt(30, 700)),
        expiresAt: plan.expiresInDays === null ? null : addDays(TODAY, plan.expiresInDays),
        uploadedById,
      },
    });
    const version = await db.documentVersion.create({
      data: {
        tenantId,
        documentId: document.id,
        version: 1,
        storageKey: stored.storageKey,
        fileName: `${plan.key.toLowerCase()}.txt`,
        mimeType: 'text/plain',
        sizeBytes: stored.sizeBytes,
        checksum: createHash('sha256').update(content).digest('hex'),
        uploadedById,
      },
    });
    await db.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });

    if (category.requiresAcknowledgement && index % 2 === 0) {
      await db.documentAcknowledgment.createMany({
        data: [{ tenantId, documentId: document.id, versionId: version.id, employeeId: employee.id }],
        skipDuplicates: true,
      });
    }
    documentIds.push(document.id);
  }

  return { documents: documentIds.length, documentIds };
}

async function seedPerformance(db: Db, tenantId: string, seeded: SeededEmployee[]) {
  if ((await db.reviewCycle.count({ where: { tenantId } })) > 0) return { reviews: 0, goals: 0 };

  const cycle = await db.reviewCycle.upsert({
    where: { tenantId_name: { tenantId, name: `FY${YEAR} Performance Review` } },
    create: {
      tenantId,
      name: `FY${YEAR} Performance Review`,
      description: 'Annual performance and development cycle',
      startDate: new Date(Date.UTC(YEAR, 0, 1)),
      endDate: new Date(Date.UTC(YEAR, 11, 31)),
      status: 'ACTIVE' as never,
      includesSelfReview: true,
      includesPeerReview: true,
    },
    update: {},
  });

  const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED').slice(0, 20);
  let reviews = 0;
  for (const [index, employee] of eligible.entries()) {
    const reviewer = seeded.find(
      (candidate) => candidate.department === employee.department && candidate.isManager && candidate.id !== employee.id,
    );
    await db.performanceReview.create({
      data: {
        tenantId,
        cycleId: cycle.id,
        employeeId: employee.id,
        reviewerId: reviewer?.id ?? null,
        type: 'MANAGER' as never,
        status: (index % 3 === 0 ? 'SUBMITTED' : index % 3 === 1 ? 'IN_PROGRESS' : 'PENDING') as never,
        overallRating: index % 3 === 0 ? 3 + (index % 5) / 2 : null,
        summary: index % 3 === 0 ? 'Consistently delivers against the agreed objectives.' : null,
        strengths: 'Ownership, collaboration and technical depth.',
        improvements: 'Delegate more and document decisions earlier.',
        submittedAt: index % 3 === 0 ? addDays(TODAY, -randomInt(5, 60)) : null,
        acknowledgedAt: index % 6 === 0 ? addDays(TODAY, -randomInt(1, 4)) : null,
      },
    });
    reviews += 1;

    if (index % 2 === 0) {
      const goal = await db.goal.create({
        data: {
          tenantId,
          employeeId: employee.id,
          title: pick([
            'Ship the next platform milestone',
            'Grow quarterly revenue by 15%',
            'Reduce onboarding time to 5 days',
            'Automate the monthly close',
            'Increase customer satisfaction to 4.6',
          ]),
          description: 'Seeded demo objective aligned with the company plan.',
          type: (index % 4 === 0 ? 'OKR' : 'GOAL') as never,
          startDate: new Date(Date.UTC(YEAR, 0, 1)),
          dueDate: new Date(Date.UTC(YEAR, 11, 15)),
          progress: (index * 13) % 100,
          status: (index % 5 === 0 ? 'ON_TRACK' : index % 5 === 1 ? 'AT_RISK' : 'ACTIVE') as never,
          priority: (index % 3 === 0 ? 'HIGH' : 'MEDIUM') as never,
          reviewCycleId: cycle.id,
        },
      });
      await db.keyResult.createMany({
        data: [
          { tenantId, goalId: goal.id, title: 'Milestone delivered', targetValue: 100, currentValue: (index * 11) % 100, unit: '%' },
          { tenantId, goalId: goal.id, title: 'Stakeholder sign-off', targetValue: 1, currentValue: index % 2, unit: 'count' },
        ],
      });
    }
  }

  return { reviews, goals: Math.ceil(eligible.length / 2) };
}

async function seedTraining(db: Db, tenantId: string, seeded: SeededEmployee[]) {
  const courses = [];
  for (const course of COURSES) {
    courses.push(
      await db.course.upsert({
        where: { tenantId_title: { tenantId, title: course.title } },
        create: {
          tenantId,
          title: course.title,
          description: `Seeded demo course: ${course.title}`,
          provider: pick(['Internal Academy', 'Udemy Business', 'Coursera']),
          category: course.category,
          durationHours: course.durationHours,
          isRequired: course.isRequired,
          validityMonths: course.validityMonths,
        },
        update: {},
      }),
    );
  }

  if ((await db.trainingAssignment.count({ where: { tenantId } })) === 0) {
    const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');
    const assignments = [];
    for (let index = 0; index < 30; index += 1) {
      const employee = eligible[(index * 5) % eligible.length]!;
      const course = courses[index % courses.length]!;
      const status = index % 5 === 0 ? 'COMPLETED' : index % 5 === 1 ? 'IN_PROGRESS' : index % 5 === 2 ? 'ASSIGNED' : index % 5 === 3 ? 'COMPLETED' : 'ASSIGNED';
      assignments.push({
        tenantId,
        employeeId: employee.id,
        courseId: course.id,
        status: status as never,
        assignedAt: addDays(TODAY, -randomInt(30, 300)),
        dueDate: addDays(TODAY, randomInt(-30, 120)),
        startedAt: status === 'ASSIGNED' ? null : addDays(TODAY, -randomInt(10, 200)),
        completedAt: status === 'COMPLETED' ? addDays(TODAY, -randomInt(1, 150)) : null,
        score: status === 'COMPLETED' ? 70 + randomInt(0, 30) : null,
      });
    }
    await db.trainingAssignment.createMany({ data: assignments, skipDuplicates: true });
  }

  if ((await db.certification.count({ where: { tenantId } })) === 0) {
    const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');
    const certifications = [];
    for (let index = 0; index < 15; index += 1) {
      const employee = eligible[(index * 3) % eligible.length]!;
      const expiring = index % 4 === 0;
      certifications.push({
        tenantId,
        employeeId: employee.id,
        name: pick(['AWS Solutions Architect', 'ISTQB Advanced', 'Scrum Master PSM I', 'CIPP/E', 'ACCA', 'Google Analytics']),
        issuer: pick(['Amazon Web Services', 'ISTQB', 'Scrum.org', 'IAPP', 'ACCA', 'Google']),
        issuedDate: addDays(TODAY, -randomInt(300, 900)),
        expiresAt: expiring ? addDays(TODAY, randomInt(20, 55)) : addDays(TODAY, randomInt(200, 700)),
        status: (expiring ? 'EXPIRING' : 'VALID') as never,
      });
    }
    await db.certification.createMany({ data: certifications, skipDuplicates: true });
  }

  return { courses: courses.length };
}

async function seedExpenses(db: Db, tenantId: string, seeded: SeededEmployee[]) {
  if ((await db.expense.count({ where: { tenantId } })) > 0) return 0;
  const categories = await db.expenseCategory.findMany({ where: { tenantId } });
  const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');
  const statuses = [
    ...Array.from({ length: 10 }, () => 'REIMBURSED'),
    ...Array.from({ length: 10 }, () => 'APPROVED'),
    ...Array.from({ length: 8 }, () => 'SUBMITTED'),
    ...Array.from({ length: 4 }, () => 'REJECTED'),
    ...Array.from({ length: 3 }, () => 'CHANGES_REQUESTED'),
    ...Array.from({ length: 3 }, () => 'DRAFT'),
    ...Array.from({ length: 2 }, () => 'CANCELLED'),
  ];

  const expenses = statuses.map((status, index) => {
    const employee = eligible[(index * 7) % eligible.length]!;
    const category = categories[index % categories.length]!;
    const expenseDate = addDays(TODAY, -randomInt(1, 100));
    return {
      tenantId,
      employeeId: employee.id,
      categoryId: category.id,
      title: pick(['Client visit', 'Team lunch', 'Conference ticket', 'Office supplies', 'Taxi', 'Cloud subscription']),
      description: 'Seeded demo expense.',
      amount: randomInt(15, 900) + 0.5,
      currency: 'EUR',
      expenseDate,
      status: status as never,
      submittedAt: status === 'DRAFT' ? null : addDays(expenseDate, 1),
      reviewedAt: ['APPROVED', 'REJECTED', 'REIMBURSED', 'CHANGES_REQUESTED'].includes(status) ? addDays(expenseDate, 3) : null,
      reviewNote: status === 'REJECTED' ? 'Missing receipt' : status === 'CHANGES_REQUESTED' ? 'Please split the travel and meal items' : null,
      reimbursedAt: status === 'REIMBURSED' ? addDays(expenseDate, 12) : null,
    };
  });

  await db.expense.createMany({ data: expenses });
  return expenses.length;
}

async function seedAssets(db: Db, tenantId: string, seeded: SeededEmployee[], assignedById: string) {
  if ((await db.asset.count({ where: { tenantId } })) > 0) return 0;
  const categories = [
    ...Array.from({ length: 12 }, () => 'LAPTOP'),
    ...Array.from({ length: 8 }, () => 'PHONE'),
    ...Array.from({ length: 5 }, () => 'MONITOR'),
    ...Array.from({ length: 3 }, () => 'ACCESS_CARD'),
    'CAR',
    'OTHER',
  ];
  const locations = await db.location.findMany({ where: { tenantId } });
  const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');

  let assigned = 0;
  for (const [index, category] of categories.entries()) {
    const isAssigned = index < 20;
    const employee = isAssigned ? eligible[(index * 2) % eligible.length]! : null;
    const asset = await db.asset.create({
      data: {
        tenantId,
        category: category as never,
        name: `${category === 'LAPTOP' ? 'ThinkPad' : category === 'PHONE' ? 'iPhone' : category === 'MONITOR' ? 'Dell UltraSharp' : category === 'CAR' ? 'Skoda Octavia' : category === 'ACCESS_CARD' ? 'Access card' : 'Conference kit'} ${100 + index}`,
        description: 'Seeded demo asset.',
        serialNumber: `ACME-${category}-${String(1000 + index)}`,
        vendor: pick(['Dell', 'Lenovo', 'Apple', 'HP', 'Skoda']),
        purchaseDate: addDays(TODAY, -randomInt(100, 900)),
        purchaseCost: randomInt(150, 25000),
        currency: 'EUR',
        warrantyEndDate: addDays(TODAY, randomInt(-100, 600)),
        condition: pick(['NEW', 'GOOD', 'FAIR']) as never,
        status: (isAssigned ? 'ASSIGNED' : 'AVAILABLE') as never,
        locationId: locations[index % locations.length]!.id,
        assignedToId: employee?.id ?? null,
        assignedAt: employee ? addDays(TODAY, -randomInt(10, 300)) : null,
      },
    });

    if (employee) {
      assigned += 1;
      await db.assetAssignment.create({
        data: {
          tenantId,
          assetId: asset.id,
          employeeId: employee.id,
          assignedAt: asset.assignedAt ?? addDays(TODAY, -30),
          conditionAtAssign: 'GOOD' as never,
          notes: 'Demo assignment',
          assignedById,
        },
      });
    }
  }

  return assigned;
}

async function seedHrRequests(db: Db, tenantId: string, seeded: SeededEmployee[], users: Map<string, { id: string }>) {
  if ((await db.hRRequest.count({ where: { tenantId } })) > 0) return 0;
  const eligible = seeded.filter((employee) => employee.status !== 'TERMINATED');
  const hrUser = users.get('hr@acme.test');
  const statuses = [
    ...Array.from({ length: 8 }, () => 'OPEN'),
    ...Array.from({ length: 6 }, () => 'IN_PROGRESS'),
    ...Array.from({ length: 3 }, () => 'WAITING_EMPLOYEE'),
    ...Array.from({ length: 5 }, () => 'RESOLVED'),
    ...Array.from({ length: 2 }, () => 'CLOSED'),
    ...Array.from({ length: 1 }, () => 'CANCELLED'),
  ];
  const priorities = [
    ...Array.from({ length: 3 }, () => 'URGENT'),
    ...Array.from({ length: 6 }, () => 'HIGH'),
    ...Array.from({ length: 12 }, () => 'NORMAL'),
    ...Array.from({ length: 4 }, () => 'LOW'),
  ];
  const types = ['HR', 'CERTIFICATE', 'DOCUMENT', 'PAYROLL', 'EQUIPMENT', 'REMOTE_WORK', 'IT', 'OTHER'];

  for (const [index, status] of statuses.entries()) {
    const employee = eligible[(index * 4) % eligible.length]!;
    const request = await db.hRRequest.create({
      data: {
        tenantId,
        employeeId: employee.id,
        type: types[index % types.length] as never,
        subject: pick([
          'Employment certificate for the bank',
          'New laptop request',
          'Payroll slip for last month',
          'Remote work arrangement',
          'Access to the HR portal',
          'Update personal details',
        ]),
        description: 'Seeded demo request created by the demo data set.',
        priority: (priorities[index] ?? 'NORMAL') as never,
        status: status as never,
        assigneeId: hrUser?.id ?? null,
        dueDate: addDays(TODAY, randomInt(-10, 20)),
        resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? addDays(TODAY, -randomInt(1, 20)) : null,
        resolution: ['RESOLVED', 'CLOSED'].includes(status) ? 'Handled by the HR team.' : null,
      },
    });

    if (index % 4 === 0) {
      await db.hRRequestComment.create({
        data: {
          tenantId,
          requestId: request.id,
          authorUserId: hrUser?.id ?? employee.id,
          body: 'Thanks — we are looking into this and will follow up shortly.',
          isInternal: index % 8 === 0,
        },
      });
    }
  }

  return statuses.length;
}

async function seedCalendar(db: Db, tenantId: string, seeded: SeededEmployee[], companyCalendarId: string, users: Map<string, { id: string; employeeId: string | null }>) {
  if ((await db.calendarEvent.count({ where: { tenantId } })) > 0) return 0;

  const manager = users.get('manager@acme.test')?.employeeId;
  const events: { title: string; type: string; startAt: Date; endAt: Date; allDay: boolean; organizer?: string | null }[] = [
    { title: 'Daily stand-up', type: 'MEETING', startAt: addDays(TODAY, 0), endAt: addDays(TODAY, 0), allDay: false, organizer: manager ?? null },
    { title: 'Company all-hands', type: 'EVENT', startAt: addDays(TODAY, 2), endAt: addDays(TODAY, 2), allDay: false, organizer: null },
    { title: 'Quarterly planning', type: 'MEETING', startAt: addDays(TODAY, 7), endAt: addDays(TODAY, 6), allDay: true, organizer: manager ?? null },
    { title: 'Security training', type: 'TRAINING', startAt: addDays(TODAY, 12), endAt: addDays(TODAY, 12), allDay: false, organizer: null },
    { title: 'Team offsite', type: 'EVENT', startAt: addDays(TODAY, 21), endAt: addDays(TODAY, 22), allDay: true, organizer: manager ?? null },
  ];

  for (const [index, event] of events.entries()) {
    const startAt = new Date(event.startAt);
    startAt.setUTCHours(event.allDay ? 0 : 9 + (index % 8), event.allDay ? 0 : 30, 0, 0);
    const endAt = new Date(event.endAt);
    endAt.setUTCHours(event.allDay ? 23 : 10 + (index % 8), event.allDay ? 59 : 30, 0, 0);
    const created = await db.calendarEvent.create({
      data: {
        tenantId,
        calendarId: companyCalendarId,
        title: event.title,
        description: 'Seeded demo calendar entry.',
        type: event.type as never,
        startAt,
        endAt,
        allDay: event.allDay,
        location: index % 2 === 0 ? 'Sofia HQ · Grand meeting room' : null,
        visibility: 'TENANT' as never,
        organizerEmployeeId: event.organizer ?? null,
      },
    });
    const attendees = seeded.filter((employee) => employee.status !== 'TERMINATED').slice(0, 4);
    await db.eventAttendee.createMany({
      data: attendees.map((attendee, position) => ({
        tenantId,
        eventId: created.id,
        employeeId: attendee.id,
        status: (position === 0 ? 'ACCEPTED' : 'INVITED') as never,
      })),
      skipDuplicates: true,
    });
  }

  return events.length;
}

async function seedNotifications(db: Db, tenantId: string, users: Map<string, { id: string }>) {
  if ((await db.notification.count({ where: { tenantId } })) > 0) return 0;

  const rows: {
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    channel: never;
    readAt: Date | null;
    sentAt: Date;
  }[] = [];

  const catalogue = [
    { type: 'leave.approved', title: 'Leave request approved', body: 'Your leave request has been approved.' },
    { type: 'document.expiring', title: 'Document expiring soon', body: 'One of your documents expires within 30 days.' },
    { type: 'training.assigned', title: 'New training assigned', body: 'Information Security Essentials was assigned to you.' },
    { type: 'expense.approved', title: 'Expense approved', body: 'Your expense report was approved for reimbursement.' },
    { type: 'request.resolved', title: 'HR request resolved', body: 'Your HR request has been resolved.' },
    { type: 'employee.birthday', title: 'Birthday tomorrow', body: 'A teammate celebrates a birthday tomorrow.' },
    { type: 'contract.expiring', title: 'Contract expiring', body: 'A fixed-term contract expires within 45 days.' },
  ];

  for (const account of ['employee@acme.test', 'manager@acme.test', 'hr@acme.test', 'admin@acme.test', 'accountant@acme.test', 'readonly@acme.test']) {
    const user = users.get(account);
    if (!user) continue;
    for (const [index, entry] of catalogue.entries()) {
      rows.push({
        tenantId,
        userId: user.id,
        type: entry.type,
        title: entry.title,
        body: entry.body,
        channel: 'IN_APP' as never,
        readAt: account === 'employee@acme.test' && index < 2 ? null : addDays(TODAY, -randomInt(1, 10)),
        sentAt: addDays(TODAY, -randomInt(1, 14)),
      });
    }
  }

  await db.notification.createMany({ data: rows });
  return rows.length;
}

async function seedAuditLog(db: Db, tenantId: string, users: Map<string, { id: string }>, seeded: SeededEmployee[]) {
  if ((await db.auditLog.count({ where: { tenantId } })) > 0) return 0;
  const admin = users.get('admin@acme.test');
  const hr = users.get('hr@acme.test');

  const entries = [
    { action: 'auth.company.register', entityType: 'Tenant', entityId: tenantId },
    { action: 'employee.create', entityType: 'Employee', entityId: seeded[0]?.id ?? null },
    { action: 'employee.update', entityType: 'Employee', entityId: seeded[1]?.id ?? null },
    { action: 'contract.create', entityType: 'Contract', entityId: null },
    { action: 'leave.request.approve', entityType: 'LeaveRequest', entityId: null },
    { action: 'expense.approve', entityType: 'Expense', entityId: null },
    { action: 'document.upload', entityType: 'Document', entityId: null },
    { action: 'asset.assign', entityType: 'Asset', entityId: null },
    { action: 'gdpr.consent.record', entityType: 'ConsentRecord', entityId: null },
    { action: 'report.export', entityType: 'ReportRun', entityId: null },
    { action: 'user.role.assign', entityType: 'User', entityId: null },
    { action: 'settings.update', entityType: 'Tenant', entityId: tenantId },
  ];

  await db.auditLog.createMany({
    data: entries.map((entry, index) => ({
      tenantId,
      actorUserId: index % 2 === 0 ? (admin?.id ?? null) : (hr?.id ?? null),
      actorType: 'USER' as never,
      actorEmail: index % 2 === 0 ? 'admin@acme.test' : 'hr@acme.test',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: { seeded: true } as never,
      createdAt: addDays(TODAY, -index),
    })),
  });
  return entries.length;
}

async function seedConsents(db: Db, tenantId: string, users: Map<string, { id: string; employeeId: string | null }>) {
  if ((await db.consentRecord.count({ where: { tenantId } })) > 0) return 0;
  const employee = users.get('employee@acme.test');
  const manager = users.get('manager@acme.test');

  const data = [
    { employeeId: employee?.employeeId ?? null, userId: employee?.id ?? null, type: 'DATA_PROCESSING', granted: true, version: '2026-01' },
    { employeeId: employee?.employeeId ?? null, userId: employee?.id ?? null, type: 'PRIVACY_POLICY', granted: true, version: '2026-01' },
    { employeeId: employee?.employeeId ?? null, userId: employee?.id ?? null, type: 'MARKETING', granted: false, version: '2026-01' },
    { employeeId: manager?.employeeId ?? null, userId: manager?.id ?? null, type: 'DATA_PROCESSING', granted: true, version: '2026-01' },
    { employeeId: manager?.employeeId ?? null, userId: manager?.id ?? null, type: 'GPS_TRACKING', granted: false, version: '2026-01' },
  ];

  await db.consentRecord.createMany({
    data: data.map((entry) => ({
      tenantId,
      employeeId: entry.employeeId,
      userId: entry.userId,
      type: entry.type as never,
      granted: entry.granted,
      version: entry.version,
      grantedAt: addDays(TODAY, -randomInt(5, 90)),
      revokedAt: entry.granted ? null : addDays(TODAY, -randomInt(1, 5)),
      source: 'seed',
    })),
  });

  return data.length;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const { hashPassword: hash } = await loadSource<typeof import('../src/common/utils/password.util.js')>(
    '../src/common/utils/password.util.ts',
  );
  return hash(password);
}

async function main(): Promise<void> {
  const started = Date.now();
  const { db, driver, close } = await createSeedDatabase();

  try {
    console.log(`\nPeopleCore seed · driver: ${driver}`);
    const tenant = await seedTenant(db);
    await seedRbac(db, tenant.id);
    const baseline = await seedBaseline(db, tenant.id);
    const org = await seedOrganization(db, tenant.id, baseline.schedules);
    const { employees } = await seedEmployees(db, tenant.id, org);
    const { users } = await seedUserAccounts(db, tenant.id, employees);
    const holidays = new Set(COMPANY_HOLIDAYS.map((holiday) => holiday.date));

    const { leaveDaysByEmployee } = await seedLeave(db, tenant.id, employees, users, holidays);
    const attendanceEntries = await seedAttendance(db, tenant.id, employees, leaveDaysByEmployee, holidays);

    // Documents are written through a local storage writer so downloads work.
    const storage = createSeedStorage(process.env['STORAGE_LOCAL_PATH'] ?? './storage/documents');
    await seedDocumentsAndContracts(
      db,
      tenant.id,
      employees,
      storage,
      users.get('hr@acme.test')?.id ?? users.get('admin@acme.test')!.id,
    );
    const performance = await seedPerformance(db, tenant.id, employees);
    const training = await seedTraining(db, tenant.id, employees);
    await seedExpenses(db, tenant.id, employees);
    const assets = await seedAssets(db, tenant.id, employees, users.get('admin@acme.test')!.id);
    await seedHrRequests(db, tenant.id, employees, users);
    const events = await seedCalendar(db, tenant.id, employees, baseline.companyCalendar.id, users);
    await seedNotifications(db, tenant.id, users);
    const auditEntries = await seedAuditLog(db, tenant.id, users, employees);
    const consents = await seedConsents(db, tenant.id, users);

    const counts = {
      employees: await db.employee.count({ where: { tenantId: tenant.id } }),
      users: await db.user.count({ where: { tenantId: tenant.id } }),
      departments: await db.department.count({ where: { tenantId: tenant.id } }),
      teams: await db.team.count({ where: { tenantId: tenant.id } }),
      locations: await db.location.count({ where: { tenantId: tenant.id } }),
      leaveRequests: await db.leaveRequest.count({ where: { tenantId: tenant.id } }),
      documents: await db.document.count({ where: { tenantId: tenant.id } }),
      contracts: await db.contract.count({ where: { tenantId: tenant.id } }),
      expenses: await db.expense.count({ where: { tenantId: tenant.id } }),
      assets: await db.asset.count({ where: { tenantId: tenant.id } }),
      hrRequests: await db.hRRequest.count({ where: { tenantId: tenant.id } }),
      certifications: await db.certification.count({ where: { tenantId: tenant.id } }),
      notifications: await db.notification.count({ where: { tenantId: tenant.id } }),
      auditEntries: await db.auditLog.count({ where: { tenantId: tenant.id } }),
    };

    console.log(`
✔ Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s
  Tenant          ${TENANT_NAME} (slug: ${tenant.slug}, id: ${tenant.id})
  Employees       ${counts.employees}  ·  Users with logins: ${counts.users}
  Organisation    ${counts.departments} departments · ${counts.teams} teams · ${counts.locations} locations
  Time tracking   ${attendanceEntries} new attendance entries (last 30 days, weekdays)
  Leave           ${counts.leaveRequests} requests · balances include 20 vacation days for ${YEAR}
  Documents       ${counts.documents} documents (2 expiring within 20–40 days)
  Contracts       ${counts.contracts} (fixed-term ending in 45 days, probation ending in 10 days)
  Performance     ${performance.reviews} reviews · ${performance.goals} goals · ${training.courses} courses
  Spend           ${counts.expenses} expenses · ${counts.assets} assets (${assets} assigned)
  Service desk    ${counts.hrRequests} HR requests · ${events} calendar events
  GDPR            ${consents} consent records · privacy settings provisioned
  Inbox           ${counts.notifications} notifications · ${counts.auditEntries} audit entries${
      auditEntries > 0 ? '' : ' (already present)'
    }

  Demo accounts — password: ${DEMO_PASSWORD}
    admin@acme.test          COMPANY_ADMIN   (full company administration)
    hr@acme.test             HR_ADMIN        (people, contracts, GDPR)
    manager@acme.test        MANAGER         (Engineering manager — team dashboards)
    accountant@acme.test     ACCOUNTANT      (compensation and expenses)
    employee@acme.test       EMPLOYEE        (self-service)
    readonly@acme.test       READ_ONLY       (company-wide read access)
    platform@peoplecore.test SUPER_ADMIN     (platform operator, no tenant)

  Sign in: POST /api/v1/auth/login  { "email": "...", "password": "${DEMO_PASSWORD}" }
`);

  } finally {
    await close();
  }
}

await main().catch((error: unknown) => {
  console.error('\n✖ Seed failed');
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
