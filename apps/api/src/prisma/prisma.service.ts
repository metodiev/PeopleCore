import { createRequire } from 'node:module';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PGlite } from '@electric-sql/pglite';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { ForbiddenError } from '../common/errors/app-error.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { applyPgliteMigrations } from './pglite-migrator.js';
import { currentContext, runWithTenantContext } from './request-context.js';
import { createTenantScopeExtension } from './tenant-scope.extension.js';

const nodeRequire = createRequire(import.meta.url);

function createScopedClient(base: PrismaClient) {
  return base.$extends(createTenantScopeExtension());
}

/** Tenant-scoped client — the default client for all feature code. */
export type ScopedPrismaClient = ReturnType<typeof createScopedClient>;
/** Transaction handle produced by {@link PrismaService.transaction}. */
export type PrismaTransaction = Omit<
  ScopedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * Database access for the whole application.
 *
 * Three access levels, deliberately explicit:
 *  - `client`   — tenant-scoped; requires a request/job context (default).
 *  - `raw`      — unscoped Prisma client; only for authentication, platform
 *                 administration and seeding. Never use it for tenant data.
 *  - `forTenant(tenantId, fn)` — scoped access from background jobs.
 *
 * With DATABASE_DRIVER=pglite the API runs against an embedded PostgreSQL
 * (WASM) instance — zero external services for local development and tests.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly base: PrismaClient;
  private readonly pglite?: PGlite;
  private readonly bridgePool?: { end: () => Promise<unknown> };

  /** Unscoped client. See class docs before using. */
  readonly raw: PrismaClient;
  /** Tenant-scoped client. */
  readonly client: ScopedPrismaClient;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.database.driver === 'pglite') {
      // Loaded lazily so production deployments never touch the WASM engine.
      const { PGlite: PGliteCtor } = nodeRequire('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
      const { pg_trgm } = nodeRequire('@electric-sql/pglite/contrib/pg_trgm') as { pg_trgm: unknown };
      const { PgBridgePool } = nodeRequire('prisma-pglite-bridge/pool') as typeof import('prisma-pglite-bridge/pool');
      const dataDir = config.database.pgliteDir ?? './.pgdata';
      const inMemory = dataDir === 'memory' || dataDir === ':memory:';
      // `pg_trgm` is loaded explicitly so the embedded engine supports the same
      // trigram indexes the search migration creates on real PostgreSQL.
      const extensions = { pg_trgm } as never;
      const pglite = inMemory
        ? new PGliteCtor({ extensions })
        : new PGliteCtor(dataDir, { extensions });
      // Durability on disk is opt-in: fsync-per-query makes the WASM engine
      // an order of magnitude slower, which is never what dev/test wants.
      const syncToFs = process.env['PGLITE_SYNC_TO_FS'] === 'true';
      const pool = new PgBridgePool({ pglite, syncToFs, connectionTimeoutMillis: 60_000 });
      this.pglite = pglite;
      this.bridgePool = pool as unknown as { end: () => Promise<unknown> };
      this.base = new PrismaClient({ adapter: new PrismaPg(pool) });
    } else {
      const pool = {
        connectionString: config.database.url,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      };
      this.base = new PrismaClient({ adapter: new PrismaPg(pool) });
    }
    this.raw = this.base;
    this.client = createScopedClient(this.base);
  }

  async onModuleInit(): Promise<void> {
    if (this.config.database.driver === 'pglite' && this.pglite) {
      await this.pglite.waitReady;
      await applyPgliteMigrations(this.pglite, (message) => this.logger.log(message));
      this.logger.log('Embedded PGlite database ready (development mode)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.raw.$disconnect().catch(() => undefined);
    await this.bridgePool?.end().catch(() => undefined);
    // The Prisma bridge leaves the lifecycle of a PGlite instance we created to
    // us; closing it releases the WASM backend so shutdown can complete.
    await this.pglite?.close().catch(() => undefined);
  }

  /**
   * Runs `fn` in a transaction on the tenant-scoped client.
   *
   * The default 5 s interactive-transaction budget is too tight for
   * multi-step HR workflows (and for the embedded PGlite driver used in
   * development), so callers get a larger, explicit window.
   */
  async transaction<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
    options: { timeout?: number; maxWait?: number } = {},
  ): Promise<T> {
    return this.client.$transaction(async (tx) => fn(tx as unknown as PrismaTransaction), {
      timeout: options.timeout ?? 30_000,
      maxWait: options.maxWait ?? 15_000,
    });
  }

  /** Scoped access for background jobs and seeders. */
  async forTenant<T>(tenantId: string, fn: (client: ScopedPrismaClient) => Promise<T>): Promise<T> {
    return runWithTenantContext(tenantId, () => fn(this.client));
  }

  /** Tenant id from the current context — convenience for services. */
  currentTenantIdOrThrow(): string {
    const tenantId = currentContext()?.tenantId;
    if (!tenantId) {
      throw new ForbiddenError('No tenant context for this operation', 'TENANT_CONTEXT_MISSING');
    }
    return tenantId;
  }

  /** True when the database is reachable. */
  async ping(): Promise<boolean> {
    try {
      await this.raw.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
