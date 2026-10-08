import { createTestApp, type TestContext } from './utils/test-app.js';

describe('Health & platform probes (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  }, 240_000);

  afterAll(async () => {
    await context?.close();
  });

  it('GET /health reports liveness', async () => {
    const response = await context.http.get('/health');
    expect(response.status).toBe(200);
    expect((response.body as { status: string }).status).toBe('ok');
  });

  it('GET /health/ready verifies the database connection', async () => {
    const response = await context.http.get<{ status: string; checks: Record<string, { status: string }> }>(
      '/health/ready',
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.database.status).toBe('up');
  });

  it('GET /metrics exposes Prometheus metrics', async () => {
    const response = await context.http.get<string>('/metrics');
    expect(response.status).toBe(200);
    expect(String(response.body)).toContain('peoplecore_http_requests_total');
    expect(String(response.body)).toContain('peoplecore_database_up 1');
  });

  it('unknown routes return the standard error envelope', async () => {
    const response = await context.http.get<{ error: { code: string }; requestId?: string }>('/api/v1/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
