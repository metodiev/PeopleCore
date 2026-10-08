import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from '../src/config/configuration.js';
import { AttendanceModule } from '../src/modules/attendance/attendance.module.js';
import { createHttpClient, type HttpClient } from './utils/http-client.js';
import { signUpCompany } from './utils/test-app.js';

interface TestApp {
  app: INestApplication;
  http: HttpClient;
  close: () => Promise<void>;
}

/**
 * Boots the real application plus the attendance module. The module is not
 * wired into AppModule yet (the platform owner does that), so the test imports
 * it explicitly — same pipes, filters, guards and versioning as production.
 */
async function createAttendanceTestApp(): Promise<TestApp> {
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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, AttendanceModule] }).compile();
  const app = moduleRef.createNestApplication();
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.init();

  const socketPath = join(process.cwd(), `.attendance-e2e-${randomUUID().slice(0, 8)}.sock`);
  await app.listen(socketPath);

  return {
    app,
    http: createHttpClient(socketPath),
    close: async () => {
      await app.close();
      await rm(socketPath, { force: true }).catch(() => undefined);
    },
  };
}

interface AttendanceBody {
  id: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  workedMinutes: number | null;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  status: string;
  source: string;
  gpsConsent: boolean;
  clockInLat: number | null;
  breaks: { id: string; minutes: number | null; endedAt: string | null }[];
}

interface ErrorBody {
  statusCode: number;
  error: { code: string; message: string };
}

interface CorrectionEventLog {
  event: string;
  tenantId: string;
  correctionId: string;
  employeeId: string;
  managerUserId: string | null;
  date: string;
  status: string;
}

describe('Attendance (e2e)', () => {
  let context: TestApp;
  let adminToken: string;
  let today: string;
  let employeeA: { id: string; token: string };
  let employeeB: { id: string };
  let gpsEmployee: { id: string };
  let selfEmployee: { id: string; token: string };
  let kioskEmployee: { id: string; employeeNumber: string };
  let correctionDate: string;
  let correctionId: string;
  let departmentId: string;
  let tenantId: string;
  let correctionEvents: CorrectionEventLog[] = [];

  const admin = () => ({ token: adminToken });
  const at = (time: string, day = today) => `${day}T${time}:00.000Z`;

  async function createEmployee(
    firstName: string,
    lastName: string,
    options: { withLogin?: boolean; departmentId?: string } = {},
  ): Promise<{ id: string; employeeNumber: string; token: string }> {
    const workEmail = `att-${randomUUID().slice(0, 8)}@example.com`;
    const created = await context.http.post<{ id: string; employeeNumber: string }>(
      '/api/v1/employees',
      {
        firstName,
        lastName,
        workEmail,
        hireDate: '2024-01-15',
        departmentId: options.departmentId,
        createUserAccount: options.withLogin ?? true,
        roleKeys: ['EMPLOYEE'],
      },
      admin(),
    );
    expect(created.status).toBe(201);

    let token = '';
    if (options.withLogin ?? true) {
      const password = 'Employee-Passw0rd!23';
      const users = await context.http.get<{ data: { id: string; email: string }[] }>(
        `/api/v1/users?search=${encodeURIComponent(workEmail)}`,
        admin(),
      );
      const userId = users.body.data.find((user) => user.email === workEmail)?.id;
      expect(userId).toBeDefined();
      await context.http.patch(`/api/v1/users/${userId}`, { password }, admin());
      const login = await context.http.post<{ tokens: { accessToken: string } }>('/api/v1/auth/login', {
        email: workEmail,
        password,
      });
      expect(login.status).toBe(200);
      token = login.body.tokens.accessToken;
    }

    return { id: created.body.id, employeeNumber: created.body.employeeNumber, token };
  }

  beforeAll(async () => {
    context = await createAttendanceTestApp();
    const company = await signUpCompany(context.http);
    adminToken = company.token;
    tenantId = company.tenantId;
    today = new Date().toISOString().slice(0, 10);
    correctionDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const emitter = context.app.get(EventEmitter2);
    for (const name of ['attendance.correction.requested', 'attendance.correction.approved', 'attendance.correction.rejected']) {
      emitter.on(name, (payload: Omit<CorrectionEventLog, 'event'>) => {
        correctionEvents.push({ event: name, ...payload });
      });
    }

    const department = await context.http.post<{ id: string }>(
      '/api/v1/departments',
      { name: `Operations ${randomUUID().slice(0, 6)}` },
      admin(),
    );
    expect(department.status).toBe(201);
    departmentId = department.body.id;

    const a = await createEmployee('Ava', 'Worker', { departmentId });
    employeeA = { id: a.id, token: a.token };
    const b = await createEmployee('Boris', 'Latecomer');
    employeeB = { id: b.id };
    const gps = await createEmployee('Greta', 'Field', { withLogin: false });
    gpsEmployee = { id: gps.id };
    const self = await createEmployee('Sam', 'Selfservice');
    selfEmployee = { id: self.id, token: self.token };
    const kiosk = await createEmployee('Kiro', 'Kiosk', { withLogin: false });
    kioskEmployee = { id: kiosk.id, employeeNumber: kiosk.employeeNumber };
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('clocks in and out for HR, computing worked and overtime minutes', async () => {
    const clockIn = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-in',
      { source: 'MANUAL', employeeId: employeeA.id, at: at('08:50') },
      admin(),
    );
    expect(clockIn.status).toBe(201);
    expect(clockIn.body.clockIn).toBe(at('08:50'));
    expect(clockIn.body.clockOut).toBeNull();
    expect(clockIn.body.status).toBe('PRESENT');
    expect(clockIn.body.lateMinutes).toBe(0);
    expect(clockIn.body.workedMinutes).toBeNull();

    const clockOut = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-out',
      { source: 'MANUAL', employeeId: employeeA.id, at: at('18:20') },
      admin(),
    );
    expect(clockOut.status).toBe(201);
    expect(clockOut.body.clockOut).toBe(at('18:20'));
    // 08:50 → 18:20 is 570 minutes; the 60 minute schedule break leaves 510.
    expect(clockOut.body.breakMinutes).toBe(60);
    expect(clockOut.body.workedMinutes).toBe(510);
    expect(clockOut.body.overtimeMinutes).toBe(30);
    expect(clockOut.body.earlyLeaveMinutes).toBe(0);
  });

  it('refuses a second clock-in on the same day', async () => {
    const first = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-in',
      { source: 'WEB' },
      { token: selfEmployee.token },
    );
    expect(first.status).toBe(201);
    expect(first.body.clockIn).not.toBeNull();

    const second = await context.http.post<ErrorBody>(
      '/api/v1/attendance/clock-in',
      { source: 'WEB' },
      { token: selfEmployee.token },
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_CLOCKED_IN');
  });

  it('flags a late arrival against the schedule start', async () => {
    const late = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-in',
      { source: 'MANUAL', employeeId: employeeB.id, at: at('09:35') },
      admin(),
    );
    expect(late.status).toBe(201);
    expect(late.body.lateMinutes).toBe(35);
    expect(late.body.status).toBe('LATE');
  });

  it('records breaks and recomputes worked minutes', async () => {
    const started = await context.http.post<{ id: string; startedAt: string }>(
      '/api/v1/attendance/breaks/start',
      { employeeId: employeeB.id, at: at('12:00') },
      admin(),
    );
    expect(started.status).toBe(201);

    const doubleStart = await context.http.post<ErrorBody>(
      '/api/v1/attendance/breaks/start',
      { employeeId: employeeB.id, at: at('12:05') },
      admin(),
    );
    expect(doubleStart.status).toBe(409);
    expect(doubleStart.body.error.code).toBe('BREAK_IN_PROGRESS');

    const ended = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/breaks/end',
      { employeeId: employeeB.id, at: at('12:30') },
      admin(),
    );
    expect(ended.status).toBe(201);
    expect(ended.body.breakMinutes).toBe(30);
    expect(ended.body.breaks).toHaveLength(1);
    expect(ended.body.breaks[0]!.minutes).toBe(30);

    const clockOut = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-out',
      { source: 'MANUAL', employeeId: employeeB.id, at: at('17:30') },
      admin(),
    );
    expect(clockOut.status).toBe(201);
    // 09:35 → 17:30 is 475 minutes, minus the recorded 30 minute break.
    expect(clockOut.body.workedMinutes).toBe(445);
    expect(clockOut.body.overtimeMinutes).toBe(0);
    expect(clockOut.body.earlyLeaveMinutes).toBe(30);
    expect(clockOut.body.breaks[0]!.endedAt).toBe(at('12:30'));
  });

  it('rejects GPS coordinates while company GPS tracking is disabled', async () => {
    const rejected = await context.http.post<ErrorBody>(
      '/api/v1/attendance/clock-in',
      {
        source: 'GPS',
        employeeId: gpsEmployee.id,
        latitude: 42.6977,
        longitude: 23.3219,
        gpsConsent: true,
        at: at('09:00'),
      },
      admin(),
    );
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
    expect(rejected.body.error.message).toContain('GPS attendance is disabled');
  });

  it('enforces the geofence and stores coordinates once GPS is enabled', async () => {
    const privacy = await context.http.patch(
      '/api/v1/tenants/current/privacy',
      { gpsTrackingEnabled: true },
      admin(),
    );
    expect(privacy.status).toBe(200);

    const location = await context.http.post<{ id: string }>(
      '/api/v1/locations',
      { name: `HQ ${randomUUID().slice(0, 6)}`, latitude: 42.6977, longitude: 23.3219, geofenceRadiusM: 150 },
      admin(),
    );
    expect(location.status).toBe(201);

    const outside = await context.http.post<ErrorBody>(
      '/api/v1/attendance/clock-in',
      {
        source: 'GPS',
        employeeId: gpsEmployee.id,
        locationId: location.body.id,
        latitude: 42.75,
        longitude: 23.4,
        gpsConsent: true,
        at: at('09:00'),
      },
      admin(),
    );
    expect(outside.status).toBe(400);
    expect(outside.body.error.message).toContain('geofence');

    const inside = await context.http.post<AttendanceBody>(
      '/api/v1/attendance/clock-in',
      {
        source: 'GPS',
        employeeId: gpsEmployee.id,
        locationId: location.body.id,
        latitude: 42.6979,
        longitude: 23.3221,
        gpsConsent: true,
        at: at('09:00'),
      },
      admin(),
    );
    expect(inside.status).toBe(201);
    expect(inside.body.clockInLat).toBeCloseTo(42.6979, 4);
    expect(inside.body.gpsConsent).toBe(true);
    // GPS punch from an employee without a work location counts as remote.
    expect(inside.body.status).toBe('REMOTE');
  });

  it('restricts punching to the caller’s own employee record', async () => {
    const colleague = await context.http.post<ErrorBody>(
      '/api/v1/attendance/clock-in',
      { source: 'WEB', employeeId: employeeB.id },
      { token: employeeA.token },
    );
    expect(colleague.status).toBe(403);
    expect(colleague.body.error.code).toBe('ATTENDANCE_SCOPE_DENIED');

    const backdated = await context.http.post<ErrorBody>(
      '/api/v1/attendance/clock-in',
      { source: 'WEB', at: at('08:00') },
      { token: selfEmployee.token },
    );
    expect(backdated.status).toBe(403);
    expect(backdated.body.error.code).toBe('PUNCH_TIME_FORBIDDEN');
  });

  it('serves the caller’s own entry for today and hides other employees from employees', async () => {
    const todayEntry = await context.http.get<AttendanceBody>('/api/v1/attendance/today', {
      token: selfEmployee.token,
    });
    expect(todayEntry.status).toBe(200);
    expect(todayEntry.body.date).toBe(today);
    expect(todayEntry.body.clockIn).not.toBeNull();
    expect(todayEntry.body.clockOut).toBeNull();

    const ownEntry = await context.http.get<AttendanceBody>('/api/v1/attendance/today', {
      token: employeeA.token,
    });
    expect(ownEntry.status).toBe(200);
    expect(ownEntry.body.clockOut).toBe(at('18:20'));

    const listAsEmployee = await context.http.get<ErrorBody>('/api/v1/attendance', {
      token: employeeA.token,
    });
    expect(listAsEmployee.status).toBe(403);

    const otherEmployee = await context.http.get<ErrorBody>(
      `/api/v1/attendance?employeeId=${employeeB.id}`,
      admin(),
    );
    expect(otherEmployee.status).toBe(200);

    const denied = await context.http.get<ErrorBody>(`/api/v1/attendance?employeeId=${employeeA.id}`, {
      token: selfEmployee.token,
    });
    expect(denied.status).toBe(403);
  });

  it('lists entries with employee details and honours the department and status filters', async () => {
    const byDepartment = await context.http.get<{
      data: (AttendanceBody & { employee: { id: string; name: string; department: { id: string } | null } })[];
      meta: { page: number; pageSize: number; total: number };
    }>(`/api/v1/attendance?departmentId=${departmentId}&from=${today}&to=${today}`, admin());
    expect(byDepartment.status).toBe(200);
    expect(byDepartment.body.data.length).toBeGreaterThan(0);
    expect(byDepartment.body.data.every((row) => row.employee.id === employeeA.id)).toBe(true);
    expect(byDepartment.body.data[0]!.employee.department?.id).toBe(departmentId);
    expect(byDepartment.body.meta.page).toBe(1);

    const lateOnly = await context.http.get<{ data: AttendanceBody[] }>(
      `/api/v1/attendance?status=LATE&from=${today}&to=${today}`,
      admin(),
    );
    expect(lateOnly.status).toBe(200);
    expect(lateOnly.body.data.length).toBeGreaterThan(0);
    expect(lateOnly.body.data.every((row) => row.status === 'LATE')).toBe(true);
    expect(lateOnly.body.data.some((row) => row.id === employeeB.id || row.lateMinutes > 0)).toBe(true);
  });

  it('requests a correction that HR approves by applying the values to the entry', async () => {
    const requested = await context.http.post<{ id: string; status: string; date: string }>(
      '/api/v1/attendance/corrections',
      {
        date: correctionDate,
        requestedClockIn: '09:00',
        requestedClockOut: '17:30',
        requestedStatus: 'PRESENT',
        reason: 'Forgot to clock out before leaving',
      },
      { token: employeeA.token },
    );
    expect(requested.status).toBe(201);
    expect(requested.body.status).toBe('PENDING');
    expect(requested.body.date).toBe(correctionDate);
    correctionId = requested.body.id;

    const duplicate = await context.http.post<ErrorBody>(
      '/api/v1/attendance/corrections',
      {
        date: correctionDate,
        requestedClockIn: '09:10',
        reason: 'Second attempt for the same day',
      },
      { token: employeeA.token },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CORRECTION_PENDING');

    const selfApprove = await context.http.post<ErrorBody>(
      `/api/v1/attendance/corrections/${correctionId}/approve`,
      {},
      { token: employeeA.token },
    );
    expect(selfApprove.status).toBe(403);

    const list = await context.http.get<{ data: { id: string; employee: { id: string } }[] }>(
      '/api/v1/attendance/corrections?status=PENDING',
      admin(),
    );
    expect(list.status).toBe(200);
    expect(list.body.data.some((row) => row.id === correctionId)).toBe(true);

    const approved = await context.http.post<{ status: string; entry: AttendanceBody }>(
      `/api/v1/attendance/corrections/${correctionId}/approve`,
      { reviewNote: 'Checked with the desk log' },
      admin(),
    );
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.entry.source).toBe('MANUAL');
    expect(approved.body.entry.status).toBe('PRESENT');
    expect(approved.body.entry.clockIn).toBe(at('09:00', correctionDate));
    expect(approved.body.entry.clockOut).toBe(at('17:30', correctionDate));
    expect(approved.body.entry.workedMinutes).toBe(450);
    expect(approved.body.entry.earlyLeaveMinutes).toBe(30);

    const listed = await context.http.get<{ data: (AttendanceBody & { employee: { name: string } })[] }>(
      `/api/v1/attendance?employeeId=${employeeA.id}&from=${correctionDate}&to=${correctionDate}`,
      admin(),
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]!.source).toBe('MANUAL');
    expect(listed.body.data[0]!.employee.name).toBe('Ava Worker');

    const again = await context.http.post<ErrorBody>(
      `/api/v1/attendance/corrections/${correctionId}/approve`,
      {},
      admin(),
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CORRECTION_DECIDED');

    const requestedEvent = correctionEvents.find(
      (event) => event.event === 'attendance.correction.requested' && event.correctionId === correctionId,
    );
    expect(requestedEvent).toBeDefined();
    expect(requestedEvent!.employeeId).toBe(employeeA.id);
    expect(requestedEvent!.tenantId).toBe(tenantId);
    expect(requestedEvent!.date).toBe(correctionDate);
    expect(requestedEvent!.status).toBe('PENDING');
    expect(requestedEvent!.managerUserId).toBeNull();

    const approvedEvent = correctionEvents.find(
      (event) => event.event === 'attendance.correction.approved' && event.correctionId === correctionId,
    );
    expect(approvedEvent).toBeDefined();
    expect(approvedEvent!.status).toBe('APPROVED');
    expect(typeof approvedEvent!.managerUserId).toBe('string');
  });

  it('rejects a correction with a review note', async () => {
    const requested = await context.http.post<{ id: string }>(
      '/api/v1/attendance/corrections',
      { date: correctionDate, requestedClockOut: '21:00', reason: 'I stayed late' },
      { token: selfEmployee.token },
    );
    expect(requested.status).toBe(201);

    const rejected = await context.http.post<{ status: string; reviewNote: string }>(
      `/api/v1/attendance/corrections/${requested.body.id}/reject`,
      { reviewNote: 'No overtime was approved for that day' },
      admin(),
    );
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.reviewNote).toBe('No overtime was approved for that day');

    const rejectedEvent = correctionEvents.find(
      (event) => event.event === 'attendance.correction.rejected' && event.correctionId === requested.body.id,
    );
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent!.employeeId).toBe(selfEmployee.id);
    expect(rejectedEvent!.status).toBe('REJECTED');

    const employeeView = await context.http.get<ErrorBody>('/api/v1/attendance/corrections', {
      token: selfEmployee.token,
    });
    expect(employeeView.status).toBe(403);
  });

  it('lists missing punches (open days and absent working days)', async () => {
    const missing = await context.http.get<{
      data: { employeeId: string; type: string; date: string }[];
      meta: { total: number };
    }>(`/api/v1/attendance/missing-punches?from=${today}&to=${today}`, admin());
    expect(missing.status).toBe(200);

    const open = missing.body.data.filter((row) => row.type === 'NO_CLOCK_OUT').map((row) => row.employeeId);
    expect(open).toContain(selfEmployee.id);
    expect(open).toContain(gpsEmployee.id);
    expect(missing.body.data.every((row) => row.date === today)).toBe(true);

    const employeeAttempt = await context.http.get<ErrorBody>('/api/v1/attendance/missing-punches', {
      token: selfEmployee.token,
    });
    expect(employeeAttempt.status).toBe(403);
  });

  it('summarises attendance totals for the requested period', async () => {
    const summary = await context.http.get<{
      from: string;
      to: string;
      totals: {
        entries: number;
        workedMinutes: number;
        overtimeMinutes: number;
        lateDays: number;
        remoteDays: number;
        missingPunches: number;
      };
    }>(`/api/v1/attendance/summary?from=${today}&to=${today}`, admin());
    expect(summary.status).toBe(200);
    expect(summary.body.from).toBe(today);
    // Ava 510 + Boris 445 minutes; Greta and Sam are still clocked in.
    expect(summary.body.totals.workedMinutes).toBe(955);
    expect(summary.body.totals.overtimeMinutes).toBe(30);
    // Boris arrived 35 minutes late; self-service punches land at the wall clock time.
    expect(summary.body.totals.lateDays).toBeGreaterThanOrEqual(1);
    expect(summary.body.totals.remoteDays).toBe(1);
    expect(summary.body.totals.missingPunches).toBe(2);

    const oneEmployee = await context.http.get<{ totals: { workedMinutes: number } }>(
      `/api/v1/attendance/summary?from=${today}&to=${today}&employeeId=${employeeB.id}`,
      admin(),
    );
    expect(oneEmployee.body.totals.workedMinutes).toBe(445);

    const employeeAttempt = await context.http.get<ErrorBody>('/api/v1/attendance/summary', {
      token: selfEmployee.token,
    });
    expect(employeeAttempt.status).toBe(403);
  });

  it('records kiosk punches by employee number for attendance managers', async () => {
    const denied = await context.http.post<ErrorBody>(
      '/api/v1/attendance/kiosk/punch',
      { employeeNumber: kioskEmployee.employeeNumber },
      { token: selfEmployee.token },
    );
    expect(denied.status).toBe(403);

    const clockIn = await context.http.post<{
      action: string;
      employee: { employeeNumber: string };
      entry: AttendanceBody;
    }>(
      '/api/v1/attendance/kiosk/punch',
      { employeeNumber: kioskEmployee.employeeNumber, source: 'KIOSK' },
      admin(),
    );
    expect(clockIn.status).toBe(201);
    expect(clockIn.body.action).toBe('CLOCK_IN');
    expect(clockIn.body.employee.employeeNumber).toBe(kioskEmployee.employeeNumber);
    expect(clockIn.body.entry.clockIn).not.toBeNull();

    const clockOut = await context.http.post<{ action: string; entry: AttendanceBody }>(
      '/api/v1/attendance/kiosk/punch',
      { employeeNumber: kioskEmployee.employeeNumber },
      admin(),
    );
    expect(clockOut.status).toBe(201);
    expect(clockOut.body.action).toBe('CLOCK_OUT');
    expect(clockOut.body.entry.clockOut).not.toBeNull();

    const afterClose = await context.http.post<ErrorBody>(
      '/api/v1/attendance/kiosk/punch',
      { employeeNumber: kioskEmployee.employeeNumber },
      admin(),
    );
    expect(afterClose.status).toBe(409);
  });
});
