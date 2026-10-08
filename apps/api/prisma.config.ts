import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * The datasource URL is resolved from DATABASE_URL. A local default is used so
 * `prisma generate` and `prisma validate` work in CI without a live database.
 * Migrations are authored offline (`prisma migrate diff`) and applied with
 * `prisma migrate deploy`; `prisma migrate dev` requires a reachable database.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --experimental-strip-types prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://peoplecore:peoplecore@localhost:5432/peoplecore',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
