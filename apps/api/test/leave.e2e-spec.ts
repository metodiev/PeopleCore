import { createTestApp, signUpCompany, type TestContext } from './utils/test-app.js';

describe('Leave management (e2e)', () => {
  let context: TestContext;
  let adminToken: string;
  let employeeId: string;
  let vacationTypeId: string;
  let employeeToken: string;

  const auth = () => ({ token: adminToken });

  beforeAll(async () => {
    context = await createTestApp();
    const company = await signUpCompany(context.http);
    adminToken = company.token;

    // Employee with a login account and a manager.
    const manager = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Mila',
        lastName: 'Boss',
        workEmail: `boss-${Date.now()}@example.com`,
        hireDate: '2023-01-10',
        createUserAccount: true,
        roleKeys: ['MANAGER'],
      },
      auth(),
    );
    expect(manager.status).toBe(201);

    const employee = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Eva',
        lastName: 'Worker',
        workEmail: `eva-${Date.now()}@example.com`,
        hireDate: '2024-05-01',
        managerId: manager.body.id,
        createUserAccount: true,
        roleKeys: ['EMPLOYEE'],
      },
      auth(),
    );
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;

    const types = await context.http.get<{ id: string; key: string }[]>('/api/v1/leave/types', auth());
    expect(types.status).toBe(200);
    vacationTypeId = types.body.find((type) => type.key === 'VACATION')!.id;
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('pre-seeded balances expose available/used/pending/remaining', async () => {
    const balances = await context.http.get<{
      balances: { leaveTypeKey: string; leaveType: string; entitled: number; used: number; pending: number; remaining: number }[];
    }>(`/api/v1/leave/balances/${employeeId}`, auth());

    expect(balances.status).toBe(200);
    const vacation = balances.body.balances.find((balance) => balance.leaveTypeKey === 'VACATION');
    expect(vacation).toBeDefined();
    expect(vacation!.entitled).toBeGreaterThan(0);
    expect(vacation!.used).toBe(0);
  });

  it('submits a leave request and blocks it on balance exhaustion', async () => {
    const tooLong = await context.http.post<{ error: { code: string } }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-06-01', endDate: '2026-08-31', employeeId },
      auth(),
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');

    const created = await context.http.post<{ id: string; days: number; status: string }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-06-01', endDate: '2026-06-05', reason: 'Family', employeeId },
      auth(),
    );
    expect(created.status).toBe(201);
    expect(created.body.days).toBe(5);
    expect(created.body.status).toBe('PENDING');
    const requestId = created.body.id;

    // The request is retrievable by id and carries the computed day count.
    const fetched = await context.http.get<{ id: string; daysRequested: number; status: string }>(
      `/api/v1/leave/requests/${requestId}`,
      auth(),
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id: requestId, daysRequested: 5, status: 'PENDING' });

    const balances = await context.http.get<{ balances: { leaveTypeId: string; pending: number }[] }>(
      `/api/v1/leave/balances/${employeeId}`,
      auth(),
    );
    expect(balances.body.balances.find((balance) => balance.leaveTypeId === vacationTypeId)!.pending).toBe(5);
  });

  it('excludes weekends and holidays from the requested days', async () => {
    await context.http.post('/api/v1/leave/holidays', { name: 'Company day', date: '2026-06-03' }, auth());

    const created = await context.http.post<{ days: number }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-06-01', endDate: '2026-06-05', employeeId },
      auth(),
    );
    expect(created.status).toBe(201);
    expect(created.body.days).toBe(4); // Mon–Fri minus the holiday on Wednesday
  });

  it('honours blackout periods', async () => {
    await context.http.post(
      '/api/v1/leave/blackouts',
      { name: 'Year-end close', startDate: '2026-12-20', endDate: '2026-12-31', leaveTypeId: vacationTypeId },
      auth(),
    );

    const blocked = await context.http.post<{ error: { message: string } }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-12-21', endDate: '2026-12-22', employeeId },
      auth(),
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toContain('blocked');
  });

  it('walks the approval chain (manager then HR) and moves pending → used', async () => {
    // Sign in as the employee to verify self-service submission.
    const employeeEmail = await findWorkEmail(employeeId);
    const employeeUser = await findUserIdByEmail(employeeEmail);
    const password = 'Employee-Passw0rd!23';
    await context.http.patch(`/api/v1/users/${employeeUser}`, { password }, auth());
    const login = await context.http.post<{ tokens: { accessToken: string } }>('/api/v1/auth/login', {
      email: employeeEmail,
      password,
    });
    expect(login.status).toBe(200);
    employeeToken = login.body.tokens.accessToken;

    const request = await context.http.post<{ id: string }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-09-07', endDate: '2026-09-11', reason: 'Holiday' },
      { token: employeeToken },
    );
    expect(request.status).toBe(201);

    const detail = await context.http.get<{ approvals: { stepOrder: number; approverType: string; status: string }[] }>(
      `/api/v1/leave/requests/${request.body.id}`,
      auth(),
    );
    expect(detail.status).toBe(200);
    expect(detail.body.approvals).toHaveLength(2);
    expect(detail.body.approvals[0]!.approverType).toBe('MANAGER');
    expect(detail.body.approvals[1]!.approverType).toBe('HR');

    // The employee cannot approve their own request.
    const selfApprove = await context.http.post(
      `/api/v1/leave/requests/${request.body.id}/approve`,
      { comment: 'nope' },
      { token: employeeToken },
    );
    expect(selfApprove.status).toBe(403);

    // HR (admin) approves both steps; only the final approval converts pending → used.
    const first = await context.http.post<{ status: string }>(
      `/api/v1/leave/requests/${request.body.id}/approve`,
      { comment: 'Step 1 ok' },
      auth(),
    );
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PENDING');

    const second = await context.http.post<{ status: string }>(
      `/api/v1/leave/requests/${request.body.id}/approve`,
      { comment: 'HR ok' },
      auth(),
    );
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('APPROVED');

    const balances = await context.http.get<{ balances: { leaveTypeId: string; used: number; pending: number }[] }>(
      `/api/v1/leave/balances/${employeeId}`,
      auth(),
    );
    const vacationBalance = balances.body.balances.find((balance) => balance.leaveTypeId === vacationTypeId)!;
    // The 5 approved days moved out of pending into `used`; the two earlier
    // June requests (5 + 4 days) remain pending.
    expect(vacationBalance.used).toBe(5);
    expect(vacationBalance.pending).toBe(9);
  });

  it('rejects a request and refunds the pending balance', async () => {
    const pendingOf = async (): Promise<number> => {
      const balances = await context.http.get<{ balances: { leaveTypeId: string; pending: number }[] }>(
        `/api/v1/leave/balances/${employeeId}`,
        auth(),
      );
      return balances.body.balances.find((balance) => balance.leaveTypeId === vacationTypeId)!.pending;
    };

    const pendingBefore = await pendingOf();

    const request = await context.http.post<{ id: string; days: number }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-10-05', endDate: '2026-10-06', employeeId },
      auth(),
    );
    expect(request.status).toBe(201);
    expect(await pendingOf()).toBe(pendingBefore + request.body.days);

    const rejected = await context.http.post<{ status: string }>(
      `/api/v1/leave/requests/${request.body.id}/reject`,
      { comment: 'Coverage gap' },
      auth(),
    );
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(await pendingOf()).toBe(pendingBefore);
  });

  it('shows approved leave in the team calendar', async () => {
    const calendar = await context.http.get<{ id: string; employee: { id: string }; days: number }[]>(
      '/api/v1/leave/calendar?from=2026-09-01&to=2026-09-30',
      auth(),
    );
    expect(calendar.status).toBe(200);
    expect(calendar.body.some((entry) => entry.employee.id === employeeId)).toBe(true);
  });

  it('refunds the used balance when an approved request is cancelled', async () => {
    const before = await context.http.get<{ balances: { leaveTypeId: string; used: number }[] }>(
      `/api/v1/leave/balances/${employeeId}`,
      auth(),
    );
    const usedBefore = before.body.balances.find((balance) => balance.leaveTypeId === vacationTypeId)!.used;

    const request = await context.http.post<{ id: string }>(
      '/api/v1/leave/requests',
      { leaveTypeId: vacationTypeId, startDate: '2026-11-02', endDate: '2026-11-03', employeeId },
      auth(),
    );
    await context.http.post(`/api/v1/leave/requests/${request.body.id}/approve`, {}, auth());
    await context.http.post(`/api/v1/leave/requests/${request.body.id}/approve`, {}, auth());

    const cancelled = await context.http.post<{ status: string }>(
      `/api/v1/leave/requests/${request.body.id}/cancel`,
      { reason: 'Plans changed' },
      auth(),
    );
    expect(cancelled.status).toBe(201);

    const after = await context.http.get<{ balances: { leaveTypeId: string; used: number }[] }>(
      `/api/v1/leave/balances/${employeeId}`,
      auth(),
    );
    expect(after.body.balances.find((balance) => balance.leaveTypeId === vacationTypeId)!.used).toBe(usedBefore);
  });

  async function findWorkEmail(id: string): Promise<string> {
    const response = await context.http.get<{ workEmail: string }>(`/api/v1/employees/${id}`, auth());
    return response.body.workEmail;
  }

  async function findUserIdByEmail(email: string): Promise<string> {
    const response = await context.http.get<{ data: { id: string; email: string }[] }>(
      `/api/v1/users?search=${encodeURIComponent(email)}`,
      auth(),
    );
    const user = response.body.data.find((candidate) => candidate.email === email);
    if (!user) throw new Error(`User ${email} not found`);
    return user.id;
  }
});
