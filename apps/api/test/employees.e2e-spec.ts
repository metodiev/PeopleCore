import { createTestApp, signUpCompany, type TestContext } from './utils/test-app.js';

describe('Employees, org structure and data scope (e2e)', () => {
  let context: TestContext;
  let adminToken: string;
  let departmentId: string;
  let locationId: string;
  let managerEmployeeId: string;
  let reportEmployeeId: string;
  let outsiderEmployeeId: string;
  let managerToken: string;

  beforeAll(async () => {
    context = await createTestApp();
    const company = await signUpCompany(context.http);
    adminToken = company.token;
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  const auth = () => ({ token: adminToken });

  it('creates organisational structure', async () => {
    const department = await context.http.post<{ id: string; name: string }>(
      '/api/v1/departments',
      { name: 'Engineering', code: 'ENG' },
      auth(),
    );
    expect(department.status).toBe(201);
    departmentId = department.body.id;

    const location = await context.http.post<{ id: string }>(
      '/api/v1/locations',
      { name: 'Sofia HQ', city: 'Sofia', country: 'Bulgaria', latitude: 42.6977, longitude: 23.3219, geofenceRadiusM: 150 },
      auth(),
    );
    expect(location.status).toBe(201);
    locationId = location.body.id;

    const teams = await context.http.post<{ id: string }>(
      '/api/v1/teams',
      { name: 'Platform', departmentId },
      auth(),
    );
    expect(teams.status).toBe(201);

    const schedule = await context.http.post<{ id: string }>(
      '/api/v1/schedules',
      {
        name: 'Standard 9-18',
        type: 'FIXED',
        workDays: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        breakMinutes: 60,
        isDefault: true,
      },
      auth(),
    );
    expect(schedule.status).toBe(201);
  });

  it('creates employees and links a login account', async () => {
    const manager = await context.http.post<{ id: string; employeeNumber: string }>(
      '/api/v1/employees',
      {
        firstName: 'Mira',
        lastName: 'Manager',
        workEmail: `mira-${Date.now()}@example.com`,
        hireDate: '2024-01-15',
        departmentId,
        locationId,
        employmentType: 'FULL_TIME',
        workingHoursPerWeek: 40,
        nationalId: '9001011234',
        createUserAccount: true,
        roleKeys: ['MANAGER'],
      },
      auth(),
    );
    expect(manager.status).toBe(201);
    expect(manager.body.employeeNumber).toMatch(/^EMP-\d{4}$/);
    managerEmployeeId = manager.body.id;

    const report = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Rado',
        lastName: 'Report',
        workEmail: `rado-${Date.now()}@example.com`,
        hireDate: '2025-02-01',
        departmentId,
        locationId,
        managerId: managerEmployeeId,
        createUserAccount: true,
        roleKeys: ['EMPLOYEE'],
      },
      auth(),
    );
    expect(report.status).toBe(201);
    reportEmployeeId = report.body.id;

    const outsider = await context.http.post<{ id: string }>(
      '/api/v1/employees',
      {
        firstName: 'Olga',
        lastName: 'Outsider',
        workEmail: `olga-${Date.now()}@example.com`,
        hireDate: '2025-03-01',
        departmentId,
        locationId,
        createUserAccount: true,
        roleKeys: ['EMPLOYEE'],
      },
      auth(),
    );
    expect(outsider.status).toBe(201);
    outsiderEmployeeId = outsider.body.id;
  });

  it('lists all employees for HR and masks sensitive fields', async () => {
    const response = await context.http.get<{ data: { id: string; firstName: string }[]; meta: { total: number } }>(
      '/api/v1/employees',
      auth(),
    );
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(3);

    const profile = await context.http.get<{ nationalId?: string; _permissions: { sensitive: boolean } }>(
      `/api/v1/employees/${managerEmployeeId}`,
      auth(),
    );
    expect(profile.status).toBe(200);
    expect(profile.body._permissions.sensitive).toBe(true);
    expect(profile.body.nationalId).toBe('9001011234');
  });

  it('returns the Employee 360 aggregate', async () => {
    const response = await context.http.get<{
      profile: { firstName: string; bankAccounts: unknown };
      employment: { contracts: unknown[] };
      organization: { department: { name: string } };
      permissions: { sensitive: boolean; salary: boolean };
    }>(`/api/v1/employees/${managerEmployeeId}/360`, auth());

    expect(response.status).toBe(200);
    expect(response.body.profile.firstName).toBe('Mira');
    expect(response.body.organization.department.name).toBe('Engineering');
    expect(response.body.permissions.sensitive).toBe(true);
    expect(response.body.permissions.salary).toBe(true);
    expect(Array.isArray(response.body.employment.contracts)).toBe(true);
  });

  it('stores profile sub-resources and protects bank data', async () => {
    const contact = await context.http.post(
      `/api/v1/employees/${managerEmployeeId}/profile/emergency-contacts`,
      { name: 'Ivan Petrov', relationship: 'Spouse', phone: '+359888123456' },
      auth(),
    );
    expect(contact.status).toBe(201);

    const bank = await context.http.post(
      `/api/v1/employees/${managerEmployeeId}/profile/bank-accounts`,
      { accountHolder: 'Mira Manager', iban: 'BG18RZBB91550123456789', bankName: 'Raiffeisen' },
      auth(),
    );
    expect(bank.status).toBe(201);

    const accounts = await context.http.get<{ ibanMasked: string; iban: string }[]>(
      `/api/v1/employees/${managerEmployeeId}/profile/bank-accounts`,
      auth(),
    );
    expect(accounts.status).toBe(200);
    expect(accounts.body[0]?.ibanMasked).toContain('••••');

    const skill = await context.http.post(
      `/api/v1/employees/${managerEmployeeId}/profile/skills`,
      { name: 'TypeScript', level: 5, category: 'Engineering' },
      auth(),
    );
    expect(skill.status).toBe(201);

    const invalidSkill = await context.http.post(
      `/api/v1/employees/${managerEmployeeId}/profile/skills`,
      { name: 'Go', level: 9 },
      auth(),
    );
    expect(invalidSkill.status).toBe(400);
  });

  it('restricts managers to their own organisation scope', async () => {
    const managerEmail = await findEmployeeEmail(managerEmployeeId);
    expect(managerEmail).toBeTruthy();

    // The invited/created users have generated passwords; sign in as the
    // manager by resetting the password through the admin API instead.
    const password = 'Manager-Passw0rd!23';
    const managerUser = await findUserIdByEmail(managerEmail!);
    const reset = await context.http.patch(
      `/api/v1/users/${managerUser}`,
      { password },
      auth(),
    );
    expect(reset.status).toBe(200);

    const login = await context.http.post<{ tokens: { accessToken: string } }>('/api/v1/auth/login', {
      email: managerEmail,
      password,
    });
    expect(login.status).toBe(200);
    managerToken = login.body.tokens.accessToken;

    const visible = await context.http.get<{ data: { id: string }[]; meta: { total: number } }>(
      '/api/v1/employees',
      { token: managerToken },
    );
    expect(visible.status).toBe(200);
    const visibleIds = visible.body.data.map((employee) => employee.id);
    expect(visibleIds).toContain(reportEmployeeId);
    expect(visibleIds).not.toContain(outsiderEmployeeId);

    const forbidden = await context.http.get(`/api/v1/employees/${outsiderEmployeeId}`, { token: managerToken });
    expect(forbidden.status).toBe(403);

    const sensitiveDenied = await context.http.get(
      `/api/v1/employees/${reportEmployeeId}/profile/bank-accounts`,
      { token: managerToken },
    );
    expect(sensitiveDenied.status).toBe(403);
  });

  it('terminates employment and revokes access', async () => {
    const response = await context.http.post(
      `/api/v1/employees/${outsiderEmployeeId}/terminate`,
      { terminationDate: '2026-02-28', reason: 'Resignation' },
      auth(),
    );
    expect(response.status).toBe(200);

    const profile = await context.http.get<{ status: string; terminationDate: string }>(
      `/api/v1/employees/${outsiderEmployeeId}`,
      auth(),
    );
    expect(profile.body.status).toBe('TERMINATED');

    const defaultList = await context.http.get<{ data: { id: string }[] }>('/api/v1/employees', auth());
    expect(defaultList.body.data.map((employee) => employee.id)).not.toContain(outsiderEmployeeId);

    const withTerminated = await context.http.get<{ data: { id: string }[] }>(
      '/api/v1/employees?includeTerminated=true',
      auth(),
    );
    expect(withTerminated.body.data.map((employee) => employee.id)).toContain(outsiderEmployeeId);
  });

  async function findEmployeeEmail(employeeId: string): Promise<string | null> {
    const response = await context.http.get<{ workEmail: string }>(`/api/v1/employees/${employeeId}`, auth());
    return response.body.workEmail ?? null;
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
