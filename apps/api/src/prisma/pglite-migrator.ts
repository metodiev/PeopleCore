import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';

const migrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url));

/**
 * Applies the committed Prisma migrations to an embedded PGlite database.
 * Used for local development without Docker and for e2e tests. The same SQL
 * files are applied by `prisma migrate deploy` against PostgreSQL.
 */
export async function applyPgliteMigrations(
  pglite: PGlite,
  log: (message: string) => void = () => {},
): Promise<void> {
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = await pglite.query<{ migration_name: string }>(
    'SELECT migration_name FROM "_prisma_migrations"',
  );
  const appliedNames = new Set(applied.rows.map((row) => row.migration_name));

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of migrationNames) {
    if (appliedNames.has(name)) continue;
    const sql = await readFile(`${migrationsDir}/${name}/migration.sql`, 'utf8');
    await pglite.exec(sql);
    await pglite.query('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name) VALUES ($1, $2, now(), $3)', [
      crypto.randomUUID(),
      'pglite',
      name,
    ]);
    log(`Applied migration ${name}`);
  }
}
