import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/configuration.js';
import { createHttpClient, type HttpClient } from './http-client.js';

export interface TestContext {
  app: INestApplication;
  http: HttpClient;
  config: AppConfig;
  /** Signs in and returns an authenticated client bound to the same app. */
  close: () => Promise<void>;
}

/**
 * Boots the real application (same pipes/filters/versioning as production)
 * against an embedded PostgreSQL instance in a throwaway data directory, and
 * exposes it over a Unix socket.
 */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  const dataDir = await mkdtemp(join(tmpdir(), 'peoplecore-test-'));
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_DRIVER'] = 'pglite';
  // In-memory Postgres: each test app gets a pristine database, and the WASM
  // engine avoids filesystem syncs (an order of magnitude faster).
  process.env['PGLITE_DATA_DIR'] = 'memory';
  process.env['PGLITE_SYNC_TO_FS'] = 'false';
  process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-0123456789-0123456789';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-0123456789-0123456789';
  process.env['ENCRYPTION_KEY'] ??= 'c0R2S1Cq1Zx3qnO0CbQ0Y1C6yXK1l2W3m4N5o6P7q8A=';
  process.env['MAIL_DRIVER'] = 'console';
  process.env['WEB_APP_URL'] = 'http://localhost:5173';
  process.env['LOG_LEVEL'] = 'error';
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.init();

  const socketPath = join(tmpdir(), `peoplecore-${randomUUID()}.sock`);
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

/** Registers a company through the public API and returns the auth context. */
export async function signUpCompany(
  http: HttpClient,
  overrides: Partial<{ companyName: string; slug: string; email: string; password: string }> = {},
): Promise<{ token: string; tenantId: string; userId: string; slug: string; email: string; password: string }> {
  const unique = randomUUID().slice(0, 8);
  const slug = overrides.slug ?? `acme-${unique}`;
  const email = overrides.email ?? `admin-${unique}@example.com`;
  const password = overrides.password ?? 'Str0ng-Passw0rd!23';

  const response = await http.post<{
    tokens: { accessToken: string };
    user: { userId: string };
    tenantId: string;
  }>('/api/v1/auth/register', {
    companyName: overrides.companyName ?? `Acme ${unique}`,
    slug,
    email,
    firstName: 'Ada',
    lastName: 'Admin',
    password,
  });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Company sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    token: response.body.tokens.accessToken,
    tenantId: response.body.tenantId,
    userId: response.body.user.userId,
    slug,
    email,
    password,
  };
}
