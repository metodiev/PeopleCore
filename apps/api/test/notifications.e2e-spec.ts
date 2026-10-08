import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NOTIFICATION_EVENTS } from '@peoplecore/shared';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from '../src/config/configuration.js';
import { JobsModule } from '../src/jobs/jobs.module.js';
import { CalendarModule } from '../src/modules/calendar/calendar.module.js';
import { IntegrationsModule } from '../src/modules/integrations/integrations.module.js';
import { NotificationsModule } from '../src/modules/notifications/notifications.module.js';
import { RemindersService } from '../src/modules/notifications/reminders.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createHttpClient, type HttpClient } from './utils/http-client.js';
import { signUpCompany } from './utils/test-app.js';

interface TestApp {
  app: INestApplication;
  http: HttpClient;
  config: AppConfig;
  close: () => Promise<void>;
}

interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  data: Record<string, unknown> | null;
}

interface PreferenceRow {
  eventType: string;
  label: string;
  mandatory: boolean;
  channels: { channel: string; enabled: boolean }[];
}

interface CalendarEntry {
  id: string;
  source: 'event' | 'holiday';
  type: string;
  title: string;
  leaveRequestId: string | null;
  readOnly: boolean;
}

/**
 * Boots the real application with the notifications/calendar/integrations
 * modules attached (the platform owner wires them into `AppModule`). The
 * harness mirrors `createTestApp` so the app runs against embedded PGlite over
 * a Unix socket.
 */
async function createTestApp(): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), 'peoplecore-notifications-'));
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_DRIVER'] = 'pglite';
  process.env['PGLITE_DATA_DIR'] = 'memory';
  process.env['PGLITE_SYNC_TO_FS'] = 'false';
  process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-0123456789-0123456789';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-0123456789-0123456789';
  process.env['ENCRYPTION_KEY'] ??= 'c0R2S1Cq1Zx3qnO0CbQ0Y1C6yXK1l2W3m4N5o6P7q8A=';
  process.env['MAIL_DRIVER'] = 'console';
  process.env['WEB_APP_URL'] = 'http://localhost:5173';
  process.env['LOG_LEVEL'] = 'error';
  delete process.env['GOOGLE_CLIENT_ID'];
  delete process.env['MICROSOFT_CLIENT_ID'];

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, JobsModule, NotificationsModule, CalendarModule, IntegrationsModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.init();

  // AF_UNIX paths are limited to ~103 characters on macOS — keep it short.
  const socketPath = join(tmpdir(), `pc-${randomUUID().slice(0, 8)}.sock`);
  await app.listen(socketPath);

  return {
    app,
    http: createHttpClient(socketPath),
    config,
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(socketPath, { force: true }).catch(() => undefined);
    },
  };
}

async function waitFor<T>(probe: () => Promise<T | undefined | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the expected state');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Notifications, calendar and integrations (e2e)', () => {
  let context: TestApp;
  let adminToken: string;
  let employeeToken: string;
  let employeeId: string;
  let employeeUserId: string;
  let employeeEmail: string;
  let vacationTypeId: string;
  let tenantId: string;
  let leaveRequestId: string;
  let approvalNotificationId: string;

  const auth = (token: string) => ({ token });

  beforeAll(async () => {
    context = await createTestApp();
    const company = await signUpCompany(context.http);
    adminToken = company.token;
    tenantId = company.tenantId;

    employeeEmail = `eva-${randomUUID().slice(0, 8)}@example.com`;
    const employee = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Eva',
        lastName: 'Worker',
        workEmail: employeeEmail,
        hireDate: '2024-05-01',
        createUserAccount: true,
        roleKeys: ['EMPLOYEE'],
      },
      auth(adminToken),
    );
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;

    const users = await context.http.get<{ data: { id: string; email: string }[] }>(
      `/api/v1/users?search=${encodeURIComponent(employeeEmail)}`,
      auth(adminToken),
    );
    const user = users.body.data.find((candidate) => candidate.email === employeeEmail);
    if (!user) throw new Error('Employee user account was not created');

    const password = 'Employee-Passw0rd!23';
    const patched = await context.http.patch(`/api/v1/users/${user.id}`, { password }, auth(adminToken));
    expect(patched.status).toBe(200);

    const login = await context.http.post<{ tokens: { accessToken: string }; user: { userId: string } }>(
      '/api/v1/auth/login',
      { email: employeeEmail, password },
    );
    expect(login.status).toBe(200);
    employeeToken = login.body.tokens.accessToken;
    employeeUserId = login.body.user.userId;

    const types = await context.http.get<{ id: string; key: string }[]>('/api/v1/leave/types', auth(adminToken));
    vacationTypeId = types.body.find((type) => type.key === 'VACATION')!.id;
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('exposes a default-enabled preference matrix per event type and channel', async () => {
    const response = await context.http.get<PreferenceRow[]>('/api/v1/notifications/preferences', auth(employeeToken));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(NOTIFICATION_EVENTS.length);

    const approved = response.body.find((row) => row.eventType === 'leave.approved')!;
    expect(approved).toBeDefined();
    expect(approved.channels.map((channel) => channel.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'PUSH', 'SMS']);
    expect(approved.channels.every((channel) => channel.enabled)).toBe(true);
    expect(approved.mandatory).toBe(false);

    const passwordReset = response.body.find((row) => row.eventType === 'user.password_reset')!;
    expect(passwordReset.mandatory).toBe(true);

    const anonymous = await context.http.get('/api/v1/notifications/preferences');
    expect(anonymous.status).toBe(401);
  });

  it('registers a notification preference and refuses to disable mandatory events', async () => {
    const updated = await context.http.put<PreferenceRow[]>(
      '/api/v1/notifications/preferences',
      { preferences: [{ eventType: 'leave.approved', channel: 'EMAIL', enabled: false }] },
      auth(employeeToken),
    );
    expect(updated.status).toBe(200);
    const approved = updated.body.find((row) => row.eventType === 'leave.approved')!;
    expect(approved.channels.find((channel) => channel.channel === 'EMAIL')!.enabled).toBe(false);
    expect(approved.channels.find((channel) => channel.channel === 'IN_APP')!.enabled).toBe(true);

    const persisted = await context.http.get<PreferenceRow[]>('/api/v1/notifications/preferences', auth(employeeToken));
    expect(
      persisted.body
        .find((row) => row.eventType === 'leave.approved')!
        .channels.find((channel) => channel.channel === 'EMAIL')!.enabled,
    ).toBe(false);

    const mandatory = await context.http.put<{ error: { code: string } }>(
      '/api/v1/notifications/preferences',
      { preferences: [{ eventType: 'user.password_reset', channel: 'EMAIL', enabled: false }] },
      auth(employeeToken),
    );
    expect(mandatory.status).toBe(400);
    expect(mandatory.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('notifies the approver on submission and the employee on approval', async () => {
    const submitted = await context.http.post<{ id: string; status: string }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-09-07', endDate: '2026-09-11', reason: 'Vacation' },
      auth(employeeToken),
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('PENDING');
    leaveRequestId = submitted.body.id;

    const approverNotification = await waitFor(async () => {
      const list = await context.http.get<{ data: NotificationRow[] }>(
        '/api/v1/notifications?pageSize=50',
        auth(adminToken),
      );
      return list.body.data.find(
        (row) => row.type === 'approval.required' && row.data?.['leaveRequestId'] === leaveRequestId,
      );
    });
    expect(approverNotification.title).toContain('approval');

    const approved = await context.http.post<{ status: string }>(
      `/api/v1/leave/requests/${leaveRequestId}/approve`,
      { comment: 'Approved' },
      auth(adminToken),
    );
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');

    const employeeNotification = await waitFor(async () => {
      const list = await context.http.get<{ data: NotificationRow[] }>(
        '/api/v1/notifications?pageSize=50',
        auth(employeeToken),
      );
      return list.body.data.find((row) => row.type === 'leave.approved' && row.data?.['leaveRequestId'] === leaveRequestId);
    });
    approvalNotificationId = employeeNotification.id;
    expect(employeeNotification.userId).toBe(employeeUserId);
    expect(employeeNotification.readAt).toBeNull();

    // Every row the caller sees belongs to the caller.
    const scoped = await context.http.get<{ data: NotificationRow[] }>(
      '/api/v1/notifications?pageSize=100',
      auth(employeeToken),
    );
    expect(scoped.body.data.every((row) => row.userId === employeeUserId)).toBe(true);
    expect(
      scoped.body.data.some((row) => row.data?.['leaveRequestId'] === leaveRequestId && row.type === 'approval.required'),
    ).toBe(false);
  });

  it('mirrors the approved leave into the company calendar as a read-only event', async () => {
    const response = await context.http.get<CalendarEntry[]>(
      '/api/v1/calendar/events?from=2026-09-01&to=2026-09-30',
      auth(employeeToken),
    );
    expect(response.status).toBe(200);
    const mirrored = response.body.find((entry) => entry.leaveRequestId === leaveRequestId);
    expect(mirrored).toBeDefined();
    expect(mirrored!.type).toBe('LEAVE');
    expect(mirrored!.readOnly).toBe(true);
  });

  it('marks a notification read and only for its owner', async () => {
    const marked = await context.http.post<{ readAt: string | null }>(
      `/api/v1/notifications/${approvalNotificationId}/read`,
      {},
      auth(employeeToken),
    );
    expect(marked.status).toBe(201);
    expect(marked.body.readAt).not.toBeNull();

    const unread = await context.http.get<{ data: NotificationRow[] }>(
      '/api/v1/notifications?unreadOnly=true&pageSize=100',
      auth(employeeToken),
    );
    expect(unread.body.data.some((row) => row.id === approvalNotificationId)).toBe(false);

    const foreign = await context.http.post(
      `/api/v1/notifications/${approvalNotificationId}/read`,
      {},
      auth(adminToken),
    );
    expect(foreign.status).toBe(404);

    const readAll = await context.http.post<{ updated: number }>(
      '/api/v1/notifications/read-all',
      {},
      auth(employeeToken),
    );
    expect(readAll.status).toBe(201);
    expect(typeof readAll.body.updated).toBe('number');
  });

  it('registers Expo push devices only for the caller', async () => {
    const token = `ExponentPushToken[test-${randomUUID()}]`;
    const registered = await context.http.post<{ token: string; userId: string; platform: string }>(
      '/api/v1/notifications/devices',
      { token, platform: 'ios', deviceName: 'Test iPhone' },
      auth(employeeToken),
    );
    expect(registered.status).toBe(201);
    expect(registered.body.userId).toBe(employeeUserId);

    const foreignDelete = await context.http.delete(
      `/api/v1/notifications/devices/${encodeURIComponent(token)}`,
      auth(adminToken),
    );
    expect(foreignDelete.status).toBe(404);

    const removed = await context.http.delete<{ deleted: boolean }>(
      `/api/v1/notifications/devices/${encodeURIComponent(token)}`,
      auth(employeeToken),
    );
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);

    const again = await context.http.delete(
      `/api/v1/notifications/devices/${encodeURIComponent(token)}`,
      auth(employeeToken),
    );
    expect(again.status).toBe(404);
  });

  it('broadcasts to a selected audience with notifications.manage', async () => {
    const forbidden = await context.http.post(
      '/api/v1/notifications/broadcast',
      { title: 'Nope', body: 'Employees cannot broadcast' },
      auth(employeeToken),
    );
    expect(forbidden.status).toBe(403);

    const broadcast = await context.http.post<{ recipients: number; delivered: number }>(
      '/api/v1/notifications/broadcast',
      { title: 'Office closed on Friday', body: 'Please plan accordingly.', employeeIds: [employeeId] },
      auth(adminToken),
    );
    expect(broadcast.status).toBe(201);
    expect(broadcast.body.recipients).toBe(1);
    expect(broadcast.body.delivered).toBe(1);

    const list = await context.http.get<{ data: NotificationRow[] }>(
      '/api/v1/notifications?pageSize=100',
      auth(employeeToken),
    );
    expect(list.body.data.some((row) => row.title === 'Office closed on Friday')).toBe(true);
  });

  it('returns holidays as read-only calendar entries and as a yearly list', async () => {
    const created = await context.http.post(
      '/api/v1/leave/holidays',
      { name: 'Company day', date: '2026-09-14' },
      auth(adminToken),
    );
    expect(created.status).toBe(201);

    const events = await context.http.get<CalendarEntry[]>(
      '/api/v1/calendar/events?from=2026-09-01&to=2026-09-30',
      auth(employeeToken),
    );
    const holiday = events.body.find((entry) => entry.source === 'holiday' && entry.title === 'Company day');
    expect(holiday).toBeDefined();
    expect(holiday!.readOnly).toBe(true);
    expect(holiday!.type).toBe('HOLIDAY');

    const holidays = await context.http.get<{ name: string; date: string }[]>(
      '/api/v1/calendar/holidays?year=2026',
      auth(employeeToken),
    );
    expect(holidays.status).toBe(200);
    expect(holidays.body.some((entry) => entry.name === 'Company day')).toBe(true);
  });

  it('runs the daily reminder sweep idempotently', async () => {
    const prisma = context.app.get(PrismaService);
    await prisma.forTenant(tenantId, (db) =>
      db.certification.create({
        data: {
          tenantId,
          employeeId,
          name: 'First Aid',
          issuedDate: new Date('2024-01-01T00:00:00.000Z'),
          expiresAt: new Date(Date.now() + 10 * 86_400_000),
          status: 'VALID',
        },
      }),
    );

    const reminders = context.app.get(RemindersService, { strict: false });
    const first = await reminders.runDaily();
    expect(first.tenants).toBeGreaterThanOrEqual(1);
    expect(first.notifications).toBeGreaterThanOrEqual(1);

    const certification = await prisma.forTenant(tenantId, (db) =>
      db.certification.findFirst({ where: { employeeId, name: 'First Aid' }, select: { id: true, status: true } }),
    );
    expect(certification?.status).toBe('EXPIRING');

    const employeeList = await context.http.get<{ data: NotificationRow[] }>(
      '/api/v1/notifications?pageSize=100',
      auth(employeeToken),
    );
    const reminder = employeeList.body.data.find(
      (row) => row.type === 'certification.expiring' && row.data?.['referenceId'] === certification!.id,
    );
    expect(reminder).toBeDefined();

    // Nothing is re-sent for the same reference within the same day.
    const second = await reminders.runDaily();
    expect(second.notifications).toBe(0);
    await prisma.forTenant(tenantId, (db) => db.certification.delete({ where: { id: certification!.id } }));
  });

  it('serves the integration catalogue, status and a guarded connect flow', async () => {
    const catalogue = await context.http.get<
      { provider: string; available: boolean; reason?: string; connection: unknown }[]
    >('/api/v1/integrations', auth(adminToken));
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.map((entry) => entry.provider)).toEqual([
      'GOOGLE',
      'MICROSOFT',
      'SLACK',
      'TEAMS',
      'PAYROLL',
      'ACCOUNTING',
      'RECRUITMENT',
    ]);

    const payroll = catalogue.body.find((entry) => entry.provider === 'PAYROLL')!;
    expect(payroll.available).toBe(false);
    expect(payroll.reason).toContain('not installed');

    // No GOOGLE_CLIENT_ID in the test environment.
    const google = catalogue.body.find((entry) => entry.provider === 'GOOGLE')!;
    expect(google.available).toBe(false);
    expect(google.reason).toContain('GOOGLE_CLIENT_ID');

    const connect = await context.http.post<{ error: { code: string } }>(
      '/api/v1/integrations/GOOGLE/connect',
      {},
      auth(adminToken),
    );
    expect(connect.status).toBe(502);
    expect(connect.body.error.code).toBe('OAUTH_NOT_CONFIGURED');

    const status = await context.http.get<{ connections: unknown[] }>(
      '/api/v1/integrations/status',
      auth(adminToken),
    );
    expect(status.status).toBe(200);
    expect(status.body.connections).toEqual([]);

    const forbidden = await context.http.get('/api/v1/integrations', auth(employeeToken));
    expect(forbidden.status).toBe(403);

    const callback = await context.http.get('/api/v1/integrations/GOOGLE/callback?code=x&state=y');
    expect(callback.status).toBe(302);
    expect(String(callback.headers['location'])).toContain('/integrations?error=');
  });
});
