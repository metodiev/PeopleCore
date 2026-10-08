import { createTestApp, signUpCompany, type TestContext } from './utils/test-app.js';

interface LoginBody {
  mfaRequired: boolean;
  tokens?: { accessToken: string; refreshToken: string };
  user?: { userId: string; permissions: string[]; roles: string[]; tenantId: string };
}

describe('Authentication & authorization (e2e)', () => {
  let context: TestContext;
  let company: Awaited<ReturnType<typeof signUpCompany>>;

  beforeAll(async () => {
    context = await createTestApp();
    company = await signUpCompany(context.http);
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('registers a company with an authenticated COMPANY_ADMIN', async () => {
    expect(company.token).toBeTruthy();
    expect(company.tenantId).toBeTruthy();
  });

  it('returns the current principal with effective permissions', async () => {
    const response = await context.http.get<{
      user: { email: string };
      tenant: { slug: string };
      roles: string[];
      permissions: string[];
    }>('/api/v1/auth/me', { token: company.token });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(company.email);
    expect(response.body.tenant.slug).toBe(company.slug);
    expect(response.body.roles).toContain('COMPANY_ADMIN');
    expect(response.body.permissions).toContain('employees.create');
    expect(response.body.permissions).toContain('settings.manage');
  });

  it('rejects invalid credentials without leaking account existence', async () => {
    const response = await context.http.post<{ error: { code: string } }>('/api/v1/auth/login', {
      email: company.email,
      password: 'WrongPassword!123',
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknown = await context.http.post<{ error: { code: string } }>('/api/v1/auth/login', {
      email: 'does-not-exist@example.com',
      password: 'WrongPassword!123',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in and rejects unauthenticated access', async () => {
    const denied = await context.http.get('/api/v1/auth/me');
    expect(denied.status).toBe(401);

    const login = await context.http.post<LoginBody>('/api/v1/auth/login', {
      email: company.email,
      password: company.password,
    });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(false);
    expect(login.body.tokens?.accessToken).toBeTruthy();
  });

  it('rotates refresh tokens and detects reuse (family revocation)', async () => {
    const login = await context.http.post<LoginBody>('/api/v1/auth/login', {
      email: company.email,
      password: company.password,
    });
    const originalRefresh = login.body.tokens!.refreshToken;

    const rotated = await context.http.post<{ accessToken: string; refreshToken: string }>('/api/v1/auth/refresh', {
      refreshToken: originalRefresh,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(originalRefresh);

    // Replaying the consumed token must revoke the whole family.
    const replay = await context.http.post<{ error: { code: string } }>('/api/v1/auth/refresh', {
      refreshToken: originalRefresh,
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    const afterFamilyRevocation = await context.http.post<{ error: { code: string } }>('/api/v1/auth/refresh', {
      refreshToken: rotated.body.refreshToken,
    });
    expect(afterFamilyRevocation.status).toBe(401);
  });

  it('revokes the session on logout immediately', async () => {
    const login = await context.http.post<LoginBody>('/api/v1/auth/login', {
      email: company.email,
      password: company.password,
    });
    const token = login.body.tokens!.accessToken;

    const before = await context.http.get('/api/v1/auth/me', { token });
    expect(before.status).toBe(200);

    const logout = await context.http.post('/api/v1/auth/logout', undefined, { token });
    expect(logout.status).toBe(204);

    const after = await context.http.get('/api/v1/auth/me', { token });
    expect(after.status).toBe(401);
  });

  it('enforces permission checks (EMPLOYEE cannot read audit logs)', async () => {
    const email = `employee-${Date.now()}@example.com`;
    const created = await context.http.post<{ id: string; email: string }>(
      '/api/v1/users',
      {
        email,
        firstName: 'Eve',
        lastName: 'Employee',
        password: 'Str0ng-Passw0rd!23',
        roleKeys: ['EMPLOYEE'],
      },
      { token: company.token },
    );
    expect(created.status).toBe(201);

    const employeeLogin = await context.http.post<LoginBody>('/api/v1/auth/login', {
      email,
      password: 'Str0ng-Passw0rd!23',
    });
    expect(employeeLogin.status).toBe(200);
    expect(employeeLogin.body.user?.roles).toContain('EMPLOYEE');

    const denied = await context.http.get<{ error: { code: string } }>('/api/v1/audit-logs', {
      token: employeeLogin.body.tokens!.accessToken,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');

    const allowedForAdmin = await context.http.get<{ meta: { total: number }; data: { action: string }[] }>(
      '/api/v1/audit-logs',
      { token: company.token },
    );
    expect(allowedForAdmin.status).toBe(200);
    expect(allowedForAdmin.body.meta.total).toBeGreaterThan(0);
    expect(allowedForAdmin.body.data.some((entry) => entry.action.includes('auth.login'))).toBe(true);

    const usersVisible = await context.http.get('/api/v1/users', { token: employeeLogin.body.tokens!.accessToken });
    expect(usersVisible.status).toBe(403);
  });

  it('supports MFA enrolment and challenges the next login', async () => {
    const setup = await context.http.post<{ secret: string; otpauthUrl: string }>(
      '/api/v1/auth/mfa/setup',
      undefined,
      { token: company.token },
    );
    expect(setup.status).toBe(201);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const { generate } = await import('otplib');
    const code = await generate({ secret: setup.body.secret });

    const enabled = await context.http.post<{ recoveryCodes: string[] }>(
      '/api/v1/auth/mfa/enable',
      { code },
      { token: company.token },
    );
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const login = await context.http.post<LoginBody>('/api/v1/auth/login', {
      email: company.email,
      password: company.password,
    });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.tokens).toBeUndefined();

    const codeAgain = await generate({ secret: setup.body.secret });
    const verified = await context.http.post<LoginBody>('/api/v1/auth/mfa/verify', {
      mfaToken: (login.body as unknown as { mfaToken: string }).mfaToken,
      code: codeAgain,
    });
    expect(verified.status).toBe(200);
    expect(verified.body.tokens?.accessToken).toBeTruthy();

    const wrongCode = await context.http.post<{ error: { code: string } }>('/api/v1/auth/mfa/verify', {
      mfaToken: (login.body as unknown as { mfaToken: string }).mfaToken,
      code: '000000',
    });
    expect(wrongCode.status).toBe(401);
    expect(wrongCode.body.error.code).toBe('MFA_CODE_INVALID');

    const disabled = await context.http.post(
      '/api/v1/auth/mfa/disable',
      { code: await generate({ secret: setup.body.secret }) },
      { token: company.token },
    );
    expect(disabled.status).toBe(200);
  });
});
